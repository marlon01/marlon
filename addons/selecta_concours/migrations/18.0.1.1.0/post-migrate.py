# -*- coding: utf-8 -*-
"""Journal d'audit : passage d'une chaîne globale à une chaîne par structure.

Les entrées antérieures formaient une chaîne unique ; elles sont rattachées à la structure
principale, sous laquelle cette chaîne historique reste intégralement vérifiable.
Les nouvelles entrées de chaque structure démarrent leur propre chaîne.
"""


def migrate(cr, version):
    cr.execute("SELECT id FROM res_company ORDER BY id LIMIT 1")
    row = cr.fetchone()
    if row:
        cr.execute("UPDATE selecta_audit_log SET company_id = %s WHERE company_id IS NULL", (row[0],))
