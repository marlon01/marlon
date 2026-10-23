# -*- coding: utf-8 -*-
"""QR code en SVG (vectoriel : net à l'impression thermique comme en A4)."""
import io

import qrcode
import qrcode.image.svg
from markupsafe import Markup


def qr_svg(data, box=4, border=2):
    if not data:
        return Markup('')
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box, border=border,
                       image_factory=qrcode.image.svg.SvgPathImage)
    qr.add_data(data)
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image().save(buf)
    svg = buf.getvalue().decode()
    svg = svg[svg.index('<svg'):]
    return Markup(svg)
