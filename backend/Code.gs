/**
 * PLATEFORME RH — BÉNIN · Backend Google Apps Script
 * Base légale : loi 2015-18 (art. 13, 104, 153-159, 161, 169, 176).
 * Mode d'emploi : voir README.md. Exécuter d'abord la fonction setup().
 */
var SHEET_ID = '1b6CWRqEkgcdfD0881oTJJWW9Hv2GwQ_hLIkvEIjiAx8';
var DOSSIER_DRIVE = 'Dossiers_RH_Benin';

var SCHEMA = {
  Agents: ['id','matricule','nom','prenoms','sexe','date_naissance','statut','structure','emploi','grade','salaire_base','date_prise_service','banque','rib','ifu','telephone','email','actif'],
  Comptes: ['id','agent_id','identifiant','mdp_hash','sel','role','doit_changer','actif','dernier_acces'],
  Statuts: ['code','libelle'],
  TypesAbsence: ['code','libelle','famille','justificatif'],
  Regles: ['type','statut','duree','unite','plafond_jours','max_fois','deduit_conge','prescription_jours','base_legale','a_verifier'],
  Demandes: ['id','agent_id','type','debut','fin','nb_jours','date_evenement','motif','statut','traite_par','traite_le','motif_refus','numero_titre','cree_le'],
  TypesPiece: ['code','libelle','origine'],
  Pieces: ['id','agent_id','type','intitule','fichier_id','nom_fichier','mime','ajoute_le'],
  Rubriques: ['code','libelle','sens','ordre'],
  Periodes: ['id','annee','mois','statut'],
  Paies: ['id','periode_id','agent_id','brut','retenues','net','decision','motif','banque','rib','decide_par','decide_le'],
  Banques: ['code','nom'],
  Journal: ['date','compte_id','action','detail']
};

/* ---------- Accès aux données ---------- */
function ss() { return SpreadsheetApp.openById(SHEET_ID); }
function sh(n) { return ss().getSheetByName(n); }
function rows(n) {
  var v = sh(n).getDataRange().getValues(), h = v.shift();
  return v.map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], 'UTC', 'yyyy-MM-dd') : String(r[j]); });
    return o;
  }).filter(function (o) { return o[SCHEMA[n][0]] !== ''; });
}
function add(n, o) { sh(n).appendRow(SCHEMA[n].map(function (k) { return o[k] === undefined ? '' : o[k]; })); }
function upd(n, row, patch) {
  var h = SCHEMA[n], s = sh(n);
  Object.keys(patch).forEach(function (k) { var c = h.indexOf(k); if (c >= 0) s.getRange(row, c + 1).setValue(patch[k]); });
}
function nextId(n) { var m = 0; rows(n).forEach(function (r) { if (+r.id > m) m = +r.id; }); return m + 1; }
function find(n, k, v) { var r = rows(n).filter(function (x) { return x[k] === String(v); }); return r[0] || null; }
function now() { return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function log(u, action, detail) { add('Journal', { date: now(), compte_id: u ? u.compte_id : '', action: action, detail: detail || '' }); }

/* ---------- Mots de passe et sessions ---------- */
function hash(p, sel) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sel + '|' + p, Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function rnd(n) { var c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
function newCompte(agentId, identifiant, role) {
  var pw = rnd(10), sel = rnd(16);
  add('Comptes', { id: nextId('Comptes'), agent_id: agentId, identifiant: identifiant, mdp_hash: hash(pw, sel), sel: sel, role: role, doit_changer: 'OUI', actif: 'OUI' });
  return pw;
}
function session(tok) {
  var s = tok && CacheService.getScriptCache().get('s_' + tok);
  if (!s) throw new Error('Session expirée, reconnectez-vous');
  return JSON.parse(s);
}

/* ---------- Point d'entrée ---------- */
function doGet() { return ContentService.createTextOutput('API RH Bénin active'); }
function doPost(e) {
  var out;
  try { out = route(JSON.parse(e.postData.contents)); }
  catch (err) { out = { ok: false, erreur: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function route(q) {
  if (q.action === 'login') return { ok: true, data: login(q) };
  var u = session(q.token), A = ACTIONS[q.action];
  if (!A) throw new Error('Action inconnue');
  if (A.roles && A.roles.indexOf(u.role) < 0) throw new Error('Accès refusé');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return { ok: true, data: A.fn(u, q) }; } finally { lock.releaseLock(); }
}

function login(q) {
  var cache = CacheService.getScriptCache(), key = 'f_' + String(q.identifiant).toLowerCase();
  if (+(cache.get(key) || 0) >= 5) throw new Error('Trop de tentatives. Réessayez dans 15 minutes.');
  var c = rows('Comptes').filter(function (x) { return x.identifiant.toLowerCase() === String(q.identifiant).toLowerCase(); })[0];
  if (!c || c.actif !== 'OUI' || hash(q.mdp, c.sel) !== c.mdp_hash) {
    cache.put(key, String(+(cache.get(key) || 0) + 1), 900);
    throw new Error('Identifiant ou mot de passe incorrect');
  }
  cache.remove(key);
  var ag = c.agent_id ? find('Agents', 'id', c.agent_id) : null;
  var u = { compte_id: c.id, agent_id: c.agent_id, role: c.role, nom: ag ? ag.prenoms + ' ' + ag.nom : c.identifiant };
  var tok = Utilities.getUuid();
  cache.put('s_' + tok, JSON.stringify(u), 21600);
  upd('Comptes', c._row, { dernier_acces: now() });
  log(u, 'connexion');
  u.token = tok; u.doit_changer = c.doit_changer === 'OUI';
  return u;
}

/* ---------- Règles de congés et d'absences ---------- */
function jours(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5) + 1; }
function regle(type, statut) {
  return rows('Regles').filter(function (r) { return r.type === type && r.statut === statut; })[0] || null;
}
function dureeMax(r) {
  if (!r.duree) return null;
  var d = +r.duree; return r.unite === 'SEMAINES' ? d * 7 : r.unite === 'MOIS' ? d * 30 : d;
}
function controle(ag, q) {
  var r = regle(q.type, ag.statut);
  if (!r) throw new Error("Aucune règle définie pour ce type d'absence et votre statut");
  if (!q.debut || !q.fin || q.fin < q.debut) throw new Error('Dates invalides');
  var nb = jours(q.debut, q.fin), dm = dureeMax(r);
  var ta = find('TypesAbsence', 'code', q.type);
  if (ta.justificatif === 'OUI' && !q.motif) throw new Error('Indiquez le motif / justificatif de la demande');
  if (dm && nb > dm) throw new Error('Durée demandée (' + nb + ' j) supérieure à la durée autorisée (' + dm + ' j)');
  if (r.prescription_jours && q.date_evenement) {
    var limite = new Date(new Date(q.date_evenement).getTime() + (+r.prescription_jours) * 864e5);
    if (new Date(q.debut) > limite) throw new Error("Demande prescrite : à déposer dans les " + r.prescription_jours + " jours suivant l'événement");
  }
  var an = q.debut.slice(0, 4), deja = 0, fois = 0;
  rows('Demandes').forEach(function (d) {
    if (d.agent_id === ag.id && d.type === q.type && (d.statut === 'SOUMISE' || d.statut === 'VALIDEE') && d.debut.slice(0, 4) === an) { deja += +d.nb_jours; fois++; }
  });
  if (r.plafond_jours && deja + nb > +r.plafond_jours) throw new Error('Plafond annuel dépassé (' + (deja + nb) + ' j sur ' + r.plafond_jours + ' j)');
  if (r.max_fois && fois + 1 > +r.max_fois) throw new Error("Nombre maximal de demandes atteint pour l'année (" + r.max_fois + ')');
  // Plafond commun des permissions : 10 jours par an (art. 159)
  if (ta.famille === 'PERMISSION') {
    var tot = 0;
    rows('Demandes').forEach(function (d) {
      var t = find('TypesAbsence', 'code', d.type);
      if (d.agent_id === ag.id && t && t.famille === 'PERMISSION' && (d.statut === 'SOUMISE' || d.statut === 'VALIDEE') && d.debut.slice(0, 4) === an) tot += +d.nb_jours;
    });
    if (tot + nb > 10) throw new Error('Total des permissions limité à 10 jours par an (déjà ' + tot + ' j)');
  }
  return nb;
}

/* ---------- Actions ---------- */
var ALL = null, RH = ['RH', 'ADMIN'], CPT = ['COMPTABLE', 'ADMIN'];
var ACTIONS = {
  moi: { roles: ALL, fn: function (u) {
    var ag = u.agent_id ? find('Agents', 'id', u.agent_id) : null;
    if (ag) { delete ag.rib; delete ag._row; }
    var types = rows('TypesAbsence').map(function (t) {
      var r = ag ? regle(t.code, ag.statut) : null;
      return { code: t.code, libelle: t.libelle, famille: t.famille, justificatif: t.justificatif, duree: r ? dureeMax(r) : null, plafond: r ? r.plafond_jours : '', base: r ? r.base_legale : '', a_verifier: r ? r.a_verifier : '' };
    });
    var an = new Date().getFullYear(), pris = 0;
    if (ag) rows('Demandes').forEach(function (d) { if (d.agent_id === ag.id && d.type === 'CONGE_ANNUEL' && d.statut === 'VALIDEE' && d.debut.slice(0, 4) === String(an)) pris += +d.nb_jours; });
    return { agent: ag, types: types, conge_annuel: { acquis: 30, pris: pris, reste: 30 - pris } };
  } },
  changer_identifiants: { roles: ALL, fn: function (u, q) {
    var c = find('Comptes', 'id', u.compte_id);
    if (hash(q.mdp_actuel, c.sel) !== c.mdp_hash) throw new Error('Mot de passe actuel incorrect');
    var patch = {};
    if (q.nouvel_identifiant && q.nouvel_identifiant !== c.identifiant) {
      if (rows('Comptes').some(function (x) { return x.identifiant.toLowerCase() === q.nouvel_identifiant.toLowerCase(); })) throw new Error('Identifiant déjà utilisé');
      patch.identifiant = q.nouvel_identifiant;
    }
    if (q.nouveau_mdp) {
      if (q.nouveau_mdp.length < 8) throw new Error('Mot de passe : 8 caractères minimum');
      patch.sel = rnd(16); patch.mdp_hash = hash(q.nouveau_mdp, patch.sel);
    }
    patch.doit_changer = 'NON'; upd('Comptes', c._row, patch); log(u, 'changement_identifiants'); return true;
  } },
  mes_demandes: { roles: ALL, fn: function (u) {
    return rows('Demandes').filter(function (d) { return d.agent_id === u.agent_id; }).reverse();
  } },
  demande_creer: { roles: ALL, fn: function (u, q) {
    var ag = find('Agents', 'id', u.agent_id); if (!ag) throw new Error('Aucun dossier agent associé à ce compte');
    var nb = controle(ag, q), id = nextId('Demandes');
    add('Demandes', { id: id, agent_id: ag.id, type: q.type, debut: q.debut, fin: q.fin, nb_jours: nb, date_evenement: q.date_evenement || '', motif: q.motif || '', statut: 'SOUMISE', cree_le: now() });
    log(u, 'demande_creer', id); return id;
  } },
  demande_annuler: { roles: ALL, fn: function (u, q) {
    var d = find('Demandes', 'id', q.id);
    if (!d || d.agent_id !== u.agent_id || d.statut !== 'SOUMISE') throw new Error('Annulation impossible');
    upd('Demandes', d._row, { statut: 'ANNULEE' }); return true;
  } },
  titre: { roles: ALL, fn: function (u, q) {
    var d = find('Demandes', 'id', q.id);
    if (!d || d.statut !== 'VALIDEE') throw new Error('Titre indisponible');
    if (d.agent_id !== u.agent_id && RH.indexOf(u.role) < 0) throw new Error('Accès refusé');
    var ag = find('Agents', 'id', d.agent_id), t = find('TypesAbsence', 'code', d.type);
    var by = d.traite_par ? find('Comptes', 'id', d.traite_par) : null;
    return { demande: d, type: t.libelle, famille: t.famille, agent: { nom: ag.nom, prenoms: ag.prenoms, matricule: ag.matricule, emploi: ag.emploi, structure: ag.structure }, signataire: by ? by.identifiant : '' };
  } },
  mes_pieces: { roles: ALL, fn: function (u) {
    var T = {}; rows('TypesPiece').forEach(function (t) { T[t.code] = t.libelle; });
    return rows('Pieces').filter(function (p) { return p.agent_id === u.agent_id; }).map(function (p) { p.type_libelle = T[p.type] || p.type; return p; });
  } },
  types_piece: { roles: ALL, fn: function () { return rows('TypesPiece'); } },
  piece_ajouter: { roles: ALL, fn: function (u, q) {
    var agentId = RH.indexOf(u.role) >= 0 && q.agent_id ? q.agent_id : u.agent_id;
    var it = DriveApp.getFoldersByName(DOSSIER_DRIVE), f = it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER_DRIVE);
    var blob = Utilities.newBlob(Utilities.base64Decode(q.base64), q.mime, q.nom);
    var file = f.createFile(blob); // fichier privé, servi uniquement par l'API
    add('Pieces', { id: nextId('Pieces'), agent_id: agentId, type: q.type, intitule: q.intitule || q.nom, fichier_id: file.getId(), nom_fichier: q.nom, mime: q.mime, ajoute_le: now() });
    log(u, 'piece_ajouter', q.nom); return true;
  } },
  piece_contenu: { roles: ALL, fn: function (u, q) {
    var p = find('Pieces', 'id', q.id);
    if (!p || (p.agent_id !== u.agent_id && RH.indexOf(u.role) < 0)) throw new Error('Accès refusé');
    var b = DriveApp.getFileById(p.fichier_id).getBlob();
    return { nom: p.nom_fichier, mime: p.mime, base64: Utilities.base64Encode(b.getBytes()) };
  } },
  mes_paies: { roles: ALL, fn: function (u, q) {
    var P = {}; rows('Periodes').forEach(function (p) { P[p.id] = p; });
    var d = +q.de, a = +q.a;
    return rows('Paies').filter(function (x) {
      var p = P[x.periode_id];
      return x.agent_id === u.agent_id && x.decision === 'VALIDE' && p && ['VALIDEE', 'PAYEE', 'CLOTUREE'].indexOf(p.statut) >= 0 && (+p.annee * 12 + +p.mois) >= d && (+p.annee * 12 + +p.mois) <= a;
    }).map(function (x) {
      var p = P[x.periode_id], ag = find('Agents', 'id', x.agent_id);
      return { id: x.id, annee: p.annee, mois: p.mois, brut: +x.brut, retenues: +x.retenues, net: +x.net, banque: x.banque, agent: ag.prenoms + ' ' + ag.nom, matricule: ag.matricule, emploi: ag.emploi, structure: ag.structure };
    }).sort(function (x, y) { return (y.annee * 12 + +y.mois) - (x.annee * 12 + +x.mois); });
  } },

  /* ----- RH ----- */
  rh_demandes: { roles: RH, fn: function (u, q) {
    var A = {}; rows('Agents').forEach(function (a) { A[a.id] = a; });
    var T = {}; rows('TypesAbsence').forEach(function (t) { T[t.code] = t.libelle; });
    return rows('Demandes').filter(function (d) { return !q.statut || d.statut === q.statut; }).map(function (d) {
      var a = A[d.agent_id]; d.agent = a ? a.prenoms + ' ' + a.nom : ''; d.type_libelle = T[d.type] || d.type; return d;
    }).reverse();
  } },
  rh_decider: { roles: RH, fn: function (u, q) {
    var d = find('Demandes', 'id', q.id);
    if (!d || d.statut !== 'SOUMISE') throw new Error('Demande déjà traitée');
    if (q.decision === 'REFUSEE' && !q.motif) throw new Error('Indiquez le motif du refus');
    var patch = { statut: q.decision, traite_par: u.compte_id, traite_le: now(), motif_refus: q.motif || '' };
    if (q.decision === 'VALIDEE') {
      var an = new Date().getFullYear(), n = rows('Demandes').filter(function (x) { return x.numero_titre; }).length + 1;
      patch.numero_titre = an + '/' + ('0000' + n).slice(-4);
    }
    upd('Demandes', d._row, patch); log(u, 'demande_' + q.decision, d.id); return true;
  } },
  rh_agents: { roles: RH, fn: function () { return rows('Agents').map(function (a) { delete a.rib; return a; }); } },
  rh_statuts: { roles: RH, fn: function () { return rows('Statuts'); } },
  rh_agent_creer: { roles: RH, fn: function (u, q) {
    if (!q.matricule || !q.nom || !q.prenoms || !q.statut || !q.date_prise_service) throw new Error('Champs obligatoires manquants');
    if (find('Agents', 'matricule', q.matricule)) throw new Error('Matricule déjà existant');
    var id = nextId('Agents');
    add('Agents', { id: id, matricule: q.matricule, nom: q.nom, prenoms: q.prenoms, sexe: q.sexe || '', date_naissance: q.date_naissance || '', statut: q.statut, structure: q.structure || '', emploi: q.emploi || '', grade: q.grade || '', salaire_base: q.salaire_base || 0, date_prise_service: q.date_prise_service, banque: q.banque || '', rib: q.rib || '', ifu: q.ifu || '', telephone: q.telephone || '', email: q.email || '', actif: 'OUI' });
    var pw = newCompte(id, q.matricule.toLowerCase(), 'AGENT');
    log(u, 'agent_creer', q.matricule); return { identifiant: q.matricule.toLowerCase(), mot_de_passe_temporaire: pw };
  } },
  rh_reset_mdp: { roles: RH, fn: function (u, q) {
    var c = rows('Comptes').filter(function (x) { return x.agent_id === String(q.agent_id); })[0];
    if (!c) throw new Error('Compte introuvable');
    var pw = rnd(10), sel = rnd(16);
    upd('Comptes', c._row, { sel: sel, mdp_hash: hash(pw, sel), doit_changer: 'OUI' }); log(u, 'reset_mdp', q.agent_id);
    return { identifiant: c.identifiant, mot_de_passe_temporaire: pw };
  } },

  /* ----- COMPTABLE ----- */
  cpt_periodes: { roles: CPT, fn: function () { return rows('Periodes').reverse(); } },
  cpt_periode_ouvrir: { roles: CPT, fn: function (u, q) {
    if (rows('Periodes').some(function (p) { return p.annee === String(q.annee) && p.mois === String(q.mois); })) throw new Error('Période déjà ouverte');
    var id = nextId('Periodes');
    add('Periodes', { id: id, annee: q.annee, mois: q.mois, statut: 'EN_VERIFICATION' });
    var pid = nextId('Paies');
    rows('Agents').filter(function (a) { return a.actif === 'OUI'; }).forEach(function (a) {
      var b = +a.salaire_base || 0;
      add('Paies', { id: pid++, periode_id: id, agent_id: a.id, brut: b, retenues: 0, net: b, decision: 'EN_ATTENTE' });
    });
    log(u, 'periode_ouvrir', q.annee + '-' + q.mois); return id;
  } },
  cpt_paies: { roles: CPT, fn: function (u, q) {
    var A = {}; rows('Agents').forEach(function (a) { A[a.id] = a; });
    return rows('Paies').filter(function (p) { return p.periode_id === String(q.periode_id); }).map(function (p) {
      var a = A[p.agent_id]; p.agent = a ? a.nom + ' ' + a.prenoms : ''; p.matricule = a ? a.matricule : ''; return p;
    });
  } },
  cpt_paie_modifier: { roles: CPT, fn: function (u, q) {
    var p = find('Paies', 'id', q.id), per = find('Periodes', 'id', p.periode_id);
    if (per.statut !== 'EN_VERIFICATION') throw new Error('Période verrouillée');
    var brut = +q.brut, ret = +q.retenues;
    upd('Paies', p._row, { brut: brut, retenues: ret, net: brut - ret }); return true;
  } },
  cpt_decider: { roles: CPT, fn: function (u, q) {
    var p = find('Paies', 'id', q.id), per = find('Periodes', 'id', p.periode_id);
    if (per.statut !== 'EN_VERIFICATION') throw new Error('Période verrouillée');
    if (q.decision === 'SUSPENDU' && !q.motif) throw new Error('Indiquez le motif de la suspension');
    var patch = { decision: q.decision, motif: q.motif || '', decide_par: u.compte_id, decide_le: now() };
    if (q.decision === 'VALIDE') { var a = find('Agents', 'id', p.agent_id); patch.banque = a.banque; patch.rib = a.rib; }
    upd('Paies', p._row, patch); log(u, 'paie_' + q.decision, p.id); return true;
  } },
  cpt_periode_valider: { roles: CPT, fn: function (u, q) {
    var att = rows('Paies').filter(function (p) { return p.periode_id === String(q.periode_id) && p.decision === 'EN_ATTENTE'; }).length;
    if (att) throw new Error(att + ' agent(s) sans décision : validez ou suspendez chacun');
    upd('Periodes', find('Periodes', 'id', q.periode_id)._row, { statut: 'VALIDEE' }); log(u, 'periode_valider', q.periode_id); return true;
  } },
  cpt_etat_banque: { roles: CPT, fn: function (u, q) {
    var A = {}; rows('Agents').forEach(function (a) { A[a.id] = a; });
    var B = {}; rows('Banques').forEach(function (b) { B[b.code] = b.nom; });
    var G = {};
    rows('Paies').filter(function (p) { return p.periode_id === String(q.periode_id) && p.decision === 'VALIDE'; }).forEach(function (p) {
      var a = A[p.agent_id], k = p.banque || 'SANS_BANQUE';
      (G[k] = G[k] || { banque: B[k] || k, lignes: [], total: 0 });
      G[k].lignes.push({ matricule: a.matricule, nom: a.nom + ' ' + a.prenoms, rib: p.rib, net: +p.net }); G[k].total += +p.net;
    });
    return Object.keys(G).map(function (k) { return G[k]; });
  } }
};

/* ---------- Installation : créer les onglets et les données ---------- */
function setup() {
  var book = ss();
  Object.keys(SCHEMA).forEach(function (n) {
    var s = book.getSheetByName(n) || book.insertSheet(n), h = SCHEMA[n];
    s.getRange(1, 1, s.getMaxRows(), h.length).setNumberFormat('@');
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#0F766E').setFontColor('#FFFFFF');
    s.setFrozenRows(1);
  });
  var first = book.getSheetByName('Feuille 1') || book.getSheetByName('Sheet1');
  if (first && book.getSheets().length > 1) try { book.deleteSheet(first); } catch (e) {}

  if (!rows('Statuts').length) {
    [['FONCTIONNAIRE', "Fonctionnaire de l'État"], ['ACE', "Agent contractuel de l'État"], ['SOUS_CONTRACTUEL', 'Agent sous contrat de la structure']].forEach(function (r) { add('Statuts', { code: r[0], libelle: r[1] }); });
    [['CONGE_ANNUEL', 'Congé annuel', 'CONGE', 'NON'], ['CONGE_MALADIE', 'Congé de maladie', 'CONGE', 'OUI'], ['CONGE_MATERNITE', 'Congé de maternité', 'CONGE', 'OUI'], ['CONGE_EXAMEN', 'Congé pour examen ou concours', 'CONGE', 'OUI'],
     ['PERM_DECES_MALADIE', 'Permission : décès ou maladie grave (conjoint, ascendant, descendant)', 'PERMISSION', 'OUI'], ['PERM_MARIAGE', "Permission : mariage de l'agent", 'PERMISSION', 'OUI'],
     ['PERM_MARIAGE_ENFANT', "Permission : mariage d'un enfant", 'PERMISSION', 'OUI'], ['PERM_NAISSANCE', 'Permission : naissance au foyer', 'PERMISSION', 'OUI'],
     ['AUTORISATION_ABS', "Autorisation d'absence (autre motif)", 'ABSENCE', 'NON']].forEach(function (r) { add('TypesAbsence', { code: r[0], libelle: r[1], famille: r[2], justificatif: r[3] }); });

    // type, durée, unité, plafond jours/an, max fois, déduit du congé, prescription, base légale, à vérifier
    var R = [['CONGE_ANNUEL', 30, 'JOURS', 30, '', 'OUI', '', 'Art. 154 : 30 jours consécutifs par année de services', 'NON'],
      ['PERM_DECES_MALADIE', 3, 'JOURS', '', '', 'NON', 30, 'Art. 159 : 3 jours ; 10 j/an max non déduits du congé', 'NON'],
      ['PERM_MARIAGE', 3, 'JOURS', '', '', 'NON', 30, 'Art. 159 : 3 jours', 'NON'],
      ['PERM_MARIAGE_ENFANT', 1, 'JOURS', '', '', 'NON', 30, 'Art. 159 : 1 jour', 'NON'],
      ['PERM_NAISSANCE', 3, 'JOURS', '', '', 'NON', 30, 'Art. 159 : 3 jours', 'NON'],
      ['CONGE_MALADIE', '', 'MOIS', 180, '', 'NON', '', 'Art. 161 : 6 mois max sur 12 mois', 'NON'],
      ['CONGE_MATERNITE', 14, 'SEMAINES', '', '', 'NON', '', 'Art. 169 : 14 semaines (6 avant, 8 après)', 'NON'],
      ['CONGE_EXAMEN', 30, 'JOURS', 30, '', 'NON', '', 'Art. 176 : durée des épreuves, 1 mois max', 'NON'],
      ['AUTORISATION_ABS', '', 'JOURS', '', '', 'NON', '', "À fixer par la DRH (nombre de fois / jours par an)", 'OUI']];
    ['FONCTIONNAIRE', 'ACE', 'SOUS_CONTRACTUEL'].forEach(function (st) {
      R.forEach(function (r) {
        add('Regles', { type: r[0], statut: st, duree: r[1], unite: r[2], plafond_jours: r[3], max_fois: r[4], deduit_conge: r[5], prescription_jours: r[6],
          base_legale: st === 'FONCTIONNAIRE' ? r[7] : 'PROVISOIRE (copie du statut fonctionnaire) — à confirmer', a_verifier: st === 'FONCTIONNAIRE' ? r[8] : 'OUI' });
      });
    });
    [['DEMANDE_NOMINATION', "Demande de nomination ou d'engagement", 'RECRUTEMENT'], ['CERT_NATIONALITE', 'Certificat de nationalité', 'RECRUTEMENT'], ['FICHE_RENSEIGN', 'Fiche de renseignements', 'RECRUTEMENT'],
     ['ACTE_NAISSANCE', "Extrait d'acte de naissance", 'RECRUTEMENT'], ['CASIER_JUDICIAIRE', 'Extrait de casier judiciaire', 'RECRUTEMENT'], ['SERVICE_MILITAIRE', 'État signalétique des services militaires', 'RECRUTEMENT'],
     ['CERT_MEDICAL', "Certificat médical d'aptitude", 'RECRUTEMENT'], ['DIPLOME', 'Copie certifiée conforme du diplôme', 'RECRUTEMENT'], ['PRISE_SERVICE', 'Certificat de prise de service', 'RECRUTEMENT'],
     ['PHOTOS', "Photos d'identité", 'RECRUTEMENT'], ['CODE_ETHIQUE', "Engagement au Code des valeurs et d'éthique", 'RECRUTEMENT'], ['CONTRAT', 'Contrat de travail', 'RECRUTEMENT'],
     ['NOMINATION', 'Acte de nomination', 'CARRIERE'], ['TITULARISATION', 'Acte de titularisation', 'CARRIERE'], ['AVANCEMENT', "Acte d'avancement ou de promotion", 'CARRIERE'],
     ['SANCTION', 'Acte portant sanction', 'CARRIERE'], ['RECOMPENSE', 'Acte portant récompense', 'CARRIERE'], ['CHANGEMENT_POSITION', 'Acte de changement de position', 'CARRIERE'],
     ['BULLETIN_NOTES', 'Bulletin de notes', 'CARRIERE'], ['AFFECTATION', "Acte d'affectation", 'GESTION'], ['AUTRE', 'Autre pièce', 'GESTION']].forEach(function (r) { add('TypesPiece', { code: r[0], libelle: r[1], origine: r[2] }); });
    [['TRAITEMENT', 'Traitement indiciaire / salaire de base', 'GAIN', 10], ['ALLOC_FAM', 'Allocations familiales', 'GAIN', 20], ['IND_RESID', 'Indemnité de résidence', 'GAIN', 30],
     ['IND_LOGEMENT', 'Indemnité de logement', 'GAIN', 40], ['PRIME_POSTE', 'Prime de fonction ou de poste et de résultats', 'GAIN', 50], ['RETENUE_PENS', 'Retenue pour pension', 'RETENUE', 110], ['IMPOT', 'Impôt sur le traitement', 'RETENUE', 120]]
      .forEach(function (r) { add('Rubriques', { code: r[0], libelle: r[1], sens: r[2], ordre: r[3] }); });
    add('Banques', { code: 'BANQUE_A', nom: 'Banque A (à renommer)' }); add('Banques', { code: 'BANQUE_B', nom: 'Banque B (à renommer)' });
  }

  var msg = 'Installation terminée.';
  if (!rows('Comptes').length) {
    add('Agents', { id: 1, matricule: 'DEMO-001', nom: 'DEMO', prenoms: 'Agent', sexe: 'F', statut: 'FONCTIONNAIRE', structure: 'Direction de démonstration', emploi: 'Gestionnaire', salaire_base: 250000, date_prise_service: '2020-01-01', banque: 'BANQUE_A', rib: 'BJ000 0000 0000 0000', actif: 'OUI' });
    var p1 = newCompte('', 'admin', 'ADMIN'), p2 = newCompte('', 'drh', 'RH'), p3 = newCompte('', 'comptable', 'COMPTABLE'), p4 = newCompte(1, 'demo', 'AGENT');
    msg += '\n\nMots de passe temporaires (à changer à la première connexion) :\nadmin : ' + p1 + '\ndrh : ' + p2 + '\ncomptable : ' + p3 + '\ndemo (agent) : ' + p4 + '\n\nNotez-les maintenant : ils ne seront plus affichés.';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}
