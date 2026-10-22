/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { parseCSV, readFileAsDataURL, readFileAsText } from "@selecta_concours/common/utils";
import { hasRole } from "@selecta_concours/admin/store";

const LETTERS = "ABCDEFGHIJ";
const COLORS = ["#0B5FFF", "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#64748B"];
const CSV_TEMPLATE =
    "question;type;points;matiere;difficulte;A;B;C;D;E;F;bonnes\n" +
    '"Quelle est la capitale du Kenya ?";single;1;Culture générale;easy;Nairobi;Mombasa;Kisumu;Nakuru;;;A\n' +
    '"Lesquels sont des nombres pairs ?";multiple;2;Mathématiques;medium;12;15;28;33;;;A,C\n';

export class QuestionBankPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page">
            <header class="ad-head">
                <div><h1>Banque de questions</h1><p class="sl-muted">Les questions utilisées par un concours ouvert sont figées : dupliquez-les pour en créer une nouvelle version.</p></div>
                <div class="ad-head-actions" t-if="canEdit">
                    <button class="sl-btn" t-on-click="() => this.state.importOpen = true"><Icon name="'upload'"/>Importer</button>
                    <button class="sl-btn sl-btn-primary" t-on-click="() => this.edit(null)"><Icon name="'plus'"/>Nouvelle question</button>
                </div>
            </header>
            <div class="ad-bank">
                <aside class="ad-panel ad-cats">
                    <div class="ad-panel-head"><h2>Matières</h2><button t-if="canEdit" class="sl-btn sl-btn-ghost sl-btn-icon" title="Nouvelle matière" t-on-click="() => this.editCat(null)"><Icon name="'plus'"/></button></div>
                    <button class="ad-cat" t-att-class="{'is-active': !state.cat}" t-on-click="() => this.state.cat = 0">
                        <span class="ad-cat-dot" style="--cat: var(--sl-ink)"/>Toutes<span class="sl-grow"/><b t-esc="state.questions.length"/>
                    </button>
                    <div t-foreach="state.categories" t-as="cat" t-key="cat.id" class="ad-cat-row">
                        <button class="ad-cat" t-att-class="{'is-active': state.cat == cat.id}" t-on-click="() => this.state.cat = cat.id">
                            <span class="ad-cat-dot" t-attf-style="--cat: {{cat.color}}"/><t t-esc="cat.name"/><span class="sl-grow"/><b t-esc="cat.count"/>
                        </button>
                        <button t-if="canEdit" class="sl-btn sl-btn-ghost sl-btn-icon" title="Modifier" t-on-click="() => this.editCat(cat)"><Icon name="'edit'" size="14"/></button>
                    </div>
                    <div t-if="state.catEdit" class="ad-cat-form">
                        <input class="sl-input" placeholder="Nom de la matière" t-model="state.catEdit.name"/>
                        <div class="ad-swatches"><button t-foreach="colors" t-as="col" t-key="col" class="ad-swatch" t-att-class="{'is-active': state.catEdit.color == col}" t-attf-style="background: {{col}}" t-on-click="() => this.state.catEdit.color = col" t-att-aria-label="col"/></div>
                        <div class="sl-row">
                            <button class="sl-btn sl-btn-sm sl-btn-primary" t-on-click="saveCat">Enregistrer</button>
                            <button class="sl-btn sl-btn-sm sl-btn-ghost" t-on-click="() => this.state.catEdit = null">Annuler</button>
                            <button t-if="state.catEdit.id" class="sl-btn sl-btn-sm sl-btn-ghost" t-on-click="deleteCat"><Icon name="'trash'" size="14"/></button>
                        </div>
                    </div>
                </aside>
                <section class="ad-panel">
                    <div class="ad-toolbar">
                        <div class="ad-search"><Icon name="'search'" size="16"/><input class="sl-input" placeholder="Rechercher un énoncé" t-model="state.search"/></div>
                        <select class="sl-select ad-w-auto" t-model="state.diff">
                            <option value="">Toutes difficultés</option><option value="easy">Facile</option><option value="medium">Moyenne</option><option value="hard">Difficile</option>
                        </select>
                        <span class="sl-muted"><t t-esc="visible.length"/> question(s)</span>
                    </div>
                    <ul class="ad-qcards">
                        <li t-foreach="visible" t-as="q" t-key="q.id" class="ad-qcard" t-att-class="{'is-locked': q.locked, 'is-archived': !q.active}">
                            <div class="ad-qcard-head">
                                <span class="ad-catpill" t-attf-style="--cat: {{q.color}}" t-esc="q.category or 'Sans matière'"/>
                                <span class="sl-muted ad-small"><t t-esc="q.qtype == 'single' ? 'Choix unique' : 'Choix multiples'"/>, <t t-esc="q.points"/> pt, <t t-esc="difficulty[q.difficulty]"/></span>
                                <span t-if="q.locked" class="sl-badge" title="Utilisée par un concours ouvert ou clôturé"><Icon name="'lock'" size="12"/>Figée</span>
                                <span t-if="q.has_image" class="sl-badge"><Icon name="'image'" size="12"/>Image</span>
                                <span class="sl-grow"/>
                                <t t-if="canEdit">
                                    <button class="sl-btn sl-btn-ghost sl-btn-icon" title="Dupliquer" t-on-click="() => this.duplicate(q)"><Icon name="'copy'" size="16"/></button>
                                    <button t-if="!q.locked" class="sl-btn sl-btn-ghost sl-btn-icon" title="Modifier" t-on-click="() => this.edit(q)"><Icon name="'edit'" size="16"/></button>
                                    <button t-if="!q.locked" class="sl-btn sl-btn-ghost sl-btn-icon" title="Supprimer" t-on-click="() => this.remove(q)"><Icon name="'trash'" size="16"/></button>
                                </t>
                            </div>
                            <p class="ad-qcard-text" t-esc="q.name"/>
                            <ol class="ad-qcard-choices">
                                <li t-foreach="q.choices" t-as="ch" t-key="ch.id" t-att-class="{'is-correct': ch.is_correct}">
                                    <span class="ad-letter" t-esc="letter(ch_index)"/><t t-esc="ch.name"/><Icon t-if="ch.is_correct" name="'check'" size="14"/>
                                </li>
                            </ol>
                        </li>
                    </ul>
                    <div t-if="state.loaded and !visible.length" class="ad-empty"><p>Aucune question ne correspond. Créez une question ou importez un fichier CSV.</p></div>
                </section>
            </div>

            <!-- Éditeur -->
            <div t-if="state.editing" class="sl-overlay">
                <div class="sl-dialog sl-dialog-wide">
                    <t t-set="q" t-value="state.editing"/>
                    <div class="sl-dialog-head"><h3 t-esc="q.id ? 'Modifier la question' : 'Nouvelle question'"/></div>
                    <div class="sl-dialog-body ad-form">
                        <div class="sl-field ad-span-2"><label>Énoncé</label><textarea class="sl-textarea" rows="3" t-model="q.name" placeholder="Rédigez une question claire et sans ambiguïté"/></div>
                        <div class="sl-field"><label>Matière</label>
                            <select class="sl-select" t-model.number="q.category_id">
                                <option value="0">Sans matière</option>
                                <option t-foreach="state.categories" t-as="cat" t-key="cat.id" t-att-value="cat.id" t-esc="cat.name"/>
                            </select>
                        </div>
                        <div class="ad-form-row">
                            <div class="sl-field"><label>Type</label>
                                <select class="sl-select" t-model="q.qtype"><option value="single">Choix unique</option><option value="multiple">Choix multiples</option></select>
                            </div>
                            <div class="sl-field"><label>Barème</label><input type="number" min="0.25" step="0.25" class="sl-input" t-model.number="q.points"/></div>
                            <div class="sl-field"><label>Difficulté</label>
                                <select class="sl-select" t-model="q.difficulty"><option value="easy">Facile</option><option value="medium">Moyenne</option><option value="hard">Difficile</option></select>
                            </div>
                        </div>
                        <div class="sl-field ad-span-2">
                            <label>Propositions <span class="sl-muted">(cochez la ou les bonnes réponses)</span></label>
                            <div t-foreach="q.choices" t-as="ch" t-key="ch_index" class="ad-choice-edit" t-att-class="{'is-correct': ch.is_correct}">
                                <span class="ad-letter" t-esc="letter(ch_index)"/>
                                <input class="sl-input" t-model="ch.name" t-att-placeholder="'Proposition ' + letter(ch_index)"/>
                                <label class="sl-check" title="Bonne réponse"><input t-att-type="q.qtype == 'single' ? 'radio' : 'checkbox'" name="correct" t-att-checked="ch.is_correct" t-on-change="() => this.setCorrect(ch_index)"/>Bonne</label>
                                <button class="sl-btn sl-btn-ghost sl-btn-icon" t-att-disabled="q.choices.length lte 2" t-on-click="() => q.choices.splice(ch_index, 1)" title="Retirer"><Icon name="'x'" size="16"/></button>
                            </div>
                            <button class="sl-btn sl-btn-sm ad-w-auto" t-att-disabled="q.choices.length gte 8" t-on-click="() => q.choices.push({name: '', is_correct: false})"><Icon name="'plus'" size="16"/>Ajouter une proposition</button>
                        </div>
                        <div class="sl-field">
                            <label>Illustration (facultatif)</label>
                            <div class="sl-row">
                                <label class="sl-btn sl-btn-sm"><Icon name="'image'" size="16"/>Choisir une image<input type="file" accept="image/*" class="sl-hidden" t-on-change="pickImage"/></label>
                                <span t-if="q.image_data" class="sl-badge sl-badge-info">Nouvelle image</span>
                                <span t-elif="q.has_image and !q.remove_image" class="sl-badge">Image enregistrée</span>
                                <button t-if="q.has_image or q.image_data" class="sl-btn sl-btn-sm sl-btn-ghost" t-on-click="clearImage">Retirer</button>
                            </div>
                        </div>
                        <div class="sl-field"><label>Explication pour le jury</label><textarea class="sl-textarea" rows="2" t-model="q.explanation" placeholder="Justification de la bonne réponse, référence"/></div>
                    </div>
                    <div class="sl-dialog-foot">
                        <button class="sl-btn" t-on-click="() => this.state.editing = null">Annuler</button>
                        <button class="sl-btn sl-btn-primary" t-on-click="save">Enregistrer la question</button>
                    </div>
                </div>
            </div>

            <!-- Import -->
            <div t-if="state.importOpen" class="sl-overlay">
                <div class="sl-dialog">
                    <div class="sl-dialog-head"><h3>Importer des questions</h3></div>
                    <div class="sl-dialog-body">
                        <p>Fichier CSV (séparateur point-virgule ou virgule, encodage UTF-8), une question par ligne :</p>
                        <pre class="ad-pre">question;type;points;matiere;difficulte;A;B;C;D;E;F;bonnes</pre>
                        <p class="sl-help">« type » vaut single ou multiple, « difficulte » easy, medium ou hard, « bonnes » liste les lettres correctes (ex. B ou A,C). Les matières inexistantes sont créées.</p>
                        <div class="sl-row sl-wrap">
                            <button class="sl-btn sl-btn-sm" t-on-click="downloadTemplate"><Icon name="'download'" size="16"/>Télécharger un modèle</button>
                            <label class="sl-btn sl-btn-sm sl-btn-primary"><Icon name="'upload'" size="16"/>Choisir le fichier<input type="file" accept=".csv,text/csv" class="sl-hidden" t-on-change="importFile"/></label>
                        </div>
                        <div t-if="state.importResult" class="sl-alert ad-mt" t-att-class="state.importResult.errors.length ? 'sl-alert-warn' : 'sl-alert-ok'">
                            <strong><t t-esc="state.importResult.created"/> question(s) importée(s).</strong>
                            <div t-foreach="state.importResult.errors.slice(0, 8)" t-as="er" t-key="er.line">Ligne <t t-esc="er.line"/> : <t t-esc="er.error"/></div>
                        </div>
                    </div>
                    <div class="sl-dialog-foot"><button class="sl-btn" t-on-click="closeImport">Fermer</button></div>
                </div>
            </div>
        </div>`;
    static props = {};

    setup() {
        this.state = useState({ questions: [], categories: [], cat: 0, search: "", diff: "", editing: null, catEdit: null, importOpen: false, importResult: null, loaded: false });
        this.colors = COLORS;
        this.difficulty = { easy: "Facile", medium: "Moyenne", hard: "Difficile" };
        onWillStart(() => this.load());
    }
    async load() {
        [this.state.questions, this.state.categories] = await Promise.all([api("questions_list"), api("categories_list")]);
        this.state.loaded = true;
    }
    get canEdit() {
        return hasRole("admin", "concepteur");
    }
    get visible() {
        const s = this.state.search.toLowerCase();
        return this.state.questions.filter(
            (q) => (!this.state.cat || q.category_id === this.state.cat) && (!s || q.name.toLowerCase().includes(s)) && (!this.state.diff || q.difficulty === this.state.diff)
        );
    }
    letter(i) {
        return LETTERS[i] || String(i + 1);
    }

    // ------------------------------------------------------------------ matières
    editCat(cat) {
        this.state.catEdit = cat ? { ...cat } : { name: "", color: COLORS[this.state.categories.length % COLORS.length] };
    }
    async saveCat() {
        if (!this.state.catEdit.name.trim()) {
            return;
        }
        try {
            this.state.categories = await api("category_save", [this.state.catEdit]);
            this.state.catEdit = null;
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    async deleteCat() {
        try {
            this.state.categories = await api("category_delete", [this.state.catEdit.id]);
            this.state.catEdit = null;
        } catch (e) {
            notify(e.message, "danger");
        }
    }

    // ------------------------------------------------------------------ questions
    edit(q) {
        this.state.editing = q
            ? { ...q, category_id: q.category_id || 0, choices: q.choices.map((c) => ({ ...c })) }
            : {
                  name: "", qtype: "single", points: 1, difficulty: "medium", explanation: "", category_id: this.state.cat || 0,
                  choices: [{ name: "", is_correct: true }, { name: "", is_correct: false }, { name: "", is_correct: false }, { name: "", is_correct: false }],
              };
    }
    setCorrect(idx) {
        const q = this.state.editing;
        if (q.qtype === "single") {
            q.choices.forEach((c, i) => (c.is_correct = i === idx));
        } else {
            q.choices[idx].is_correct = !q.choices[idx].is_correct;
        }
    }
    clearImage() {
        this.state.editing.image_data = false;
        this.state.editing.remove_image = true;
    }
    closeImport() {
        this.state.importOpen = false;
        this.state.importResult = null;
    }
    async pickImage(ev) {
        const f = ev.target.files[0];
        if (f) {
            if (f.size > 3 * 1024 * 1024) {
                notify("Image trop lourde (3 Mo maximum).", "danger");
                return;
            }
            this.state.editing.image_data = await readFileAsDataURL(f);
            this.state.editing.remove_image = false;
        }
    }
    async save() {
        const q = this.state.editing;
        try {
            const saved = await api("question_save", [{ ...q, category_id: q.category_id || false }]);
            const idx = this.state.questions.findIndex((x) => x.id === saved.id);
            if (idx >= 0) {
                this.state.questions[idx] = saved;
            } else {
                this.state.questions.unshift(saved);
            }
            this.state.editing = null;
            this.state.categories = await api("categories_list");
            notify("Question enregistrée.", "ok");
        } catch (e) {
            notify(e.message, "danger", 8000);
        }
    }
    async duplicate(q) {
        const copy = await api("question_duplicate", [q.id]);
        this.state.questions.unshift(copy);
        notify("Nouvelle version créée : vous pouvez la modifier.", "ok");
    }
    async remove(q) {
        if (!(await confirmDialog({ title: "Supprimer cette question ?", body: q.name, confirmLabel: "Supprimer", danger: true }))) {
            return;
        }
        try {
            const res = await api("question_delete", [q.id]);
            notify(res.archived ? "Question archivée (déjà utilisée par un concours)." : "Question supprimée.", "ok");
            await this.load();
        } catch (e) {
            notify(e.message, "danger");
        }
    }

    // ------------------------------------------------------------------ import
    downloadTemplate() {
        const blob = new Blob(["﻿" + CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "modele_questions_selecta.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    async importFile(ev) {
        const f = ev.target.files[0];
        ev.target.value = "";
        if (!f) {
            return;
        }
        const rows = parseCSV(await readFileAsText(f));
        if (rows.length && /question/i.test(rows[0][0])) {
            rows.shift();
        }
        const data = rows.map((r) => {
            const good = (r[11] || "").toUpperCase().split(/[,\s/]+/).filter(Boolean);
            const choices = [];
            for (let i = 0; i < 6; i++) {
                const text = (r[5 + i] || "").trim();
                if (text) {
                    choices.push({ text, correct: good.includes(LETTERS[i]) });
                }
            }
            return { question: r[0] || "", type: (r[1] || "").trim().toLowerCase(), points: r[2], category: r[3], difficulty: (r[4] || "").trim().toLowerCase(), choices };
        });
        try {
            this.state.importResult = await api("questions_import", [data]);
            await this.load();
        } catch (e) {
            notify(e.message, "danger");
        }
    }
}
