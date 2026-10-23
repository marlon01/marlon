# -*- coding: utf-8 -*-
from unittest.mock import patch
from urllib.parse import unquote

from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.selecta_concours.models.selecta_messaging import normalize_phone
from .common import SaasCommon


class FakeResp:
    def __init__(self, status=201, payload=None):
        self.status_code = status
        self.ok = status < 300
        self._payload = payload or {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


@tagged('post_install', '-at_install')
class TestCodesSend(SaasCommon):

    def _setup(self, provider='twilio', whatsapp=True):
        icp = self.env['ir.config_parameter'].sudo()
        icp.set_param('selecta.msg.provider', provider)
        icp.set_param('selecta.msg.username', 'naxoris')
        icp.set_param('selecta.msg.account_sid', 'AC123')
        icp.set_param('selecta.msg.api_key', 'secret')
        icp.set_param('selecta.msg.sms_from', 'SELECTA')
        icp.set_param('selecta.msg.whatsapp_from', '+14155238886' if whatsapp else '')

    def _issued(self, phone='0812345678'):
        c = self._concours(self.user_a)
        c.write({'exam_venue': "Siège, salle A"})
        self.bo(self.user_a).candidate_save({'concours_id': c.id, 'name': "Grâce Ngalula", 'reference': "S-1",
                                             'phone': phone})
        res = self.bo(self.user_a).generate_codes(c.id)
        return c, res['codes'][0]

    def test_phone_numbers_are_made_international(self):
        cd = self.env.ref('base.cd')
        self.assertEqual(normalize_phone('0812345678', cd), '+243812345678')
        self.assertEqual(normalize_phone('+243 81 234 5678', cd), '+243812345678')
        self.assertEqual(normalize_phone('00243812345678', cd), '+243812345678')
        self.assertEqual(normalize_phone('812345678', cd), '+243812345678')
        self.assertEqual(normalize_phone('12', cd), '')
        self.assertEqual(normalize_phone('', cd), '')

    def test_channels_depend_on_the_configuration(self):
        Msg = self.env['selecta.messaging']
        self.assertEqual(Msg.channels(), [])
        self._setup('africastalking')
        self.assertEqual(Msg.channels(), ['sms'])
        self._setup('twilio')
        self.assertEqual(Msg.channels(), ['sms', 'whatsapp'])
        self._setup('twilio', whatsapp=False)
        self.assertEqual(Msg.channels(), ['sms'])

    def test_code_is_sent_once_verified_and_never_stored(self):
        self._setup('twilio')
        concours, issued = self._issued()
        calls = []

        def fake_post(url, data=None, auth=None, timeout=None, **kw):
            calls.append(data)
            return FakeResp(201, {'sid': 'SM1'})

        with patch('odoo.addons.selecta_concours.models.selecta_messaging.requests.post', fake_post):
            res = self.bo(self.user_a).codes_send(concours.id, [{'id': issued['id'], 'code': issued['code']}], 'whatsapp')
            self.assertEqual(res['sent'], 1)
            self.assertEqual(calls[0]['To'], 'whatsapp:+243812345678')
            self.assertIn(issued['code'], calls[0]['Body'])
            self.assertIn("Siège, salle A", calls[0]['Body'])
            # Un texte qui n'est pas le vrai code n'est jamais envoyé.
            res = self.bo(self.user_a).codes_send(concours.id, [{'id': issued['id'], 'code': 'AAAA-BBBB-CCCC'}], 'sms')
            self.assertEqual(res['sent'], 0)
            self.assertEqual(res['results'][0]['error'], "code invalide")
            self.assertEqual(len(calls), 1)
        cand = self.env['selecta.candidate'].browse(issued['id'])
        self.assertEqual(cand.code_sent_via, 'whatsapp')
        self.assertTrue(cand.code_sent_at)
        log = self.env['selecta.audit.log'].sudo().search([('event', '=', 'codes.send')], limit=1)
        self.assertTrue(log)
        self.assertNotIn(issued['code'], str(log.read()[0]), "le code n'apparaît pas dans le journal")

    def test_unconfigured_channel_or_missing_phone(self):
        concours, issued = self._issued(phone='')
        with patch('odoo.addons.selecta_concours.models.selecta_messaging.requests.post') as post:
            res = self.bo(self.user_a).codes_send(concours.id, [{'id': issued['id'], 'code': issued['code']}], 'sms')
            post.assert_not_called()
        self.assertEqual(res['sent'], 0)
        with self.assertRaises(UserError):
            self.bo(self.user_a).codes_send(concours.id, [], 'fax')

    def test_africastalking_sms(self):
        self._setup('africastalking')
        concours, issued = self._issued()
        payload = {'SMSMessageData': {'Recipients': [{'status': 'Success', 'number': '+243812345678'}]}}
        with patch('odoo.addons.selecta_concours.models.selecta_messaging.requests.post',
                   return_value=FakeResp(201, payload)) as post:
            res = self.bo(self.user_a).codes_send(concours.id, [{'id': issued['id'], 'code': issued['code']}], 'sms')
        self.assertEqual(res['sent'], 1)
        self.assertEqual(post.call_args.kwargs['data']['to'], '+243812345678')

    def test_whatsapp_links_without_any_service(self):
        concours, issued = self._issued()
        links = self.bo(self.user_a).codes_whatsapp_links(concours.id, [{'id': issued['id'], 'code': issued['code']}])
        self.assertTrue(links[0]['url'].startswith('https://wa.me/243812345678?text='))
        self.assertIn(issued['code'], unquote(links[0]['url']))
        self.assertFalse(self.bo(self.user_a).codes_whatsapp_links(concours.id, [{'id': issued['id'], 'code': 'X'}]))

    def test_other_organisation_cannot_send(self):
        self._setup('twilio')
        concours, issued = self._issued()
        with patch('odoo.addons.selecta_concours.models.selecta_messaging.requests.post') as post:
            try:
                res = self.bo(self.user_b).codes_send(concours.id, [{'id': issued['id'], 'code': issued['code']}], 'sms')
                self.assertEqual(res['sent'], 0)
            except Exception:  # noqa: BLE001 - refus d'accès : attendu aussi
                pass
            post.assert_not_called()

    def test_platform_settings_validate_the_provider(self):
        admin = self.env.ref('base.user_admin')
        Platform = self.env['selecta.saas.platform'].with_user(admin)
        with self.assertRaises(UserError):
            Platform.settings_save({'msg_provider': 'pigeon'})
        data = Platform.settings_save({'msg_provider': 'twilio', 'msg_account_sid': 'AC1', 'msg_api_key': 'tok',
                                       'msg_sms_from': 'SELECTA'})
        self.assertEqual(data['msg_channels'], ['sms'])
        self.assertTrue(data['msg_api_key_set'])
        self.assertNotIn('msg_api_key', data)
