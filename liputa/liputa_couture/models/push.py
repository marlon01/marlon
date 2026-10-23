# -*- coding: utf-8 -*-
"""Web push notifications for clients, workshops and platform administrators.

Devices are the standard Odoo ``mail.push.device`` records (one per browser
subscription, shared with the Odoo web client used by administrators). The
Liputa queue sends with a long TTL: the push service keeps the message until
the phone comes back online, so it arrives even when the phone was switched
off or the app closed (Odoo's own queue uses a 60-second TTL, made for chat).
"""
import json
import logging
from urllib.parse import urlsplit

from requests import Session

from odoo import api, fields, models
from odoo.addons.mail.tools import jwt
from odoo.addons.mail.tools.web_push import DeviceUnreachableError, _encrypt_payload

_logger = logging.getLogger(__name__)

PUSH_TTL = 3 * 24 * 3600  # le service push garde le message 3 jours si le téléphone est éteint
MAX_TEXT = 240


class LiputaPushMessage(models.Model):
    _name = "liputa.push.message"
    _description = "Queued web push notification"
    _order = "id"

    device_id = fields.Many2one("mail.push.device", required=True, ondelete="cascade", index=True)
    payload = fields.Text(required=True)

    @api.model
    def _liputa_send(self, partners, title, body, url=None, model=None, res_id=None, tag=None):
        """Queue one notification for every device of ``partners`` and wake the sender.

        The payload follows Odoo's format ({title, options}) so the same push also
        opens correctly on an administrator's Odoo web client service worker.
        """
        partners = partners.exists() if partners else partners
        if not partners:
            return 0
        devices = self.env["mail.push.device"].sudo().search([("partner_id", "in", partners.ids)])
        if not devices:
            return 0
        data = {"url": url or "/"}
        if model and res_id:
            data.update(model=model, res_id=res_id)
        payload = json.dumps({
            "title": (title or "Liputa")[:80],
            "options": {
                "body": (body or "")[:MAX_TEXT],
                "icon": "/liputa_couture/static/src/app/img/icon-512.png",
                "badge": "/liputa_couture/static/src/app/img/icon-512.png",
                "tag": tag or "liputa",
                "renotify": True,
                "data": data,
            },
        })
        self.sudo().create([{"device_id": d.id, "payload": payload} for d in devices])
        self.env.ref("liputa_couture.ir_cron_liputa_push")._trigger()
        return len(devices)

    @api.model
    def _vapid_keys(self):
        params = self.env["ir.config_parameter"].sudo()
        public = self.env["mail.push.device"].sudo().get_web_push_vapid_public_key()
        return params.get_param("mail.web_push_vapid_private_key"), public

    def _post(self, session, device, payload, private_key, public_key):
        endpoint = device.endpoint
        url = urlsplit(endpoint)
        if url.netloc.endswith(".invalid"):
            raise DeviceUnreachableError("Device Unreachable")
        token = jwt.sign({"aud": "%s://%s" % (url.scheme, url.netloc), "sub": self.get_base_url()},
                         private_key, ttl=12 * 60 * 60, algorithm=jwt.Algorithm.ES256)
        body = _encrypt_payload(payload.encode(), {"keys": device.keys})
        response = session.post(endpoint, data=body, timeout=8, headers={
            "Authorization": "vapid t=%s, k=%s" % (token, public_key),
            "Content-Encoding": "aes128gcm",
            "TTL": str(PUSH_TTL),
            "Urgency": "high",
        })
        if response.status_code in (404, 410):
            raise DeviceUnreachableError("Device Unreachable")
        if response.status_code >= 300:
            _logger.warning("Liputa push: %s answered %s", url.netloc, response.status_code)

    @api.model
    def _cron_send(self, batch_size=100):
        queue = self.sudo().search([], limit=batch_size)
        if not queue:
            return
        private_key, public_key = self._vapid_keys()
        session = Session()
        gone = set()
        for msg in queue:
            device = msg.device_id
            if device.id in gone:
                continue
            try:
                self._post(session, device, msg.payload, private_key, public_key)
            except DeviceUnreachableError:
                gone.add(device.id)
            except Exception as exc:  # noqa: BLE001 - un appareil en panne ne bloque pas les autres
                _logger.warning("Liputa push failed for device %s: %s", device.id, exc)
        queue.unlink()
        if gone:
            self.env["mail.push.device"].sudo().browse(list(gone)).unlink()
        if self.sudo().search_count([]):
            self.env.ref("liputa_couture.ir_cron_liputa_push")._trigger()
