-- =====================================================================
-- PLATEFORME RH — FONCTION PUBLIQUE DU BÉNIN
-- Base de données PostgreSQL 14+
-- Base légale principale : Loi n° 2015-18 portant statut général de la
-- fonction publique (art. 104, 153-159, 161, 169, 175-176).
-- Les règles marquées a_verifier = TRUE sont PROVISOIRES : à confirmer
-- avec les textes applicables aux contractuels avant mise en production.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. RÉFÉRENTIELS ------------------------------------------

CREATE TABLE statuts_agent (
  id           SMALLSERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  libelle      TEXT NOT NULL,
  base_legale  TEXT
);

CREATE TABLE structures (          -- hôpital, centre de santé, bureau de zone, direction…
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  nom        TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('HOPITAL','CENTRE_SANTE','BUREAU_ZONE','AUTRE')),
  ville      TEXT,
  ministere  TEXT,
  actif      BOOLEAN NOT NULL DEFAULT TRUE,
  parent_id  INT REFERENCES structures(id)
);

CREATE TABLE banques (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,
  nom   TEXT NOT NULL
);

-- Carrière du fonctionnaire (art. 84-97) : catégorie A-D, échelle 1-3,
-- grade (5 grades), échelon, indice.
CREATE TABLE grades (
  id         SERIAL PRIMARY KEY,
  categorie  CHAR(1)  NOT NULL CHECK (categorie IN ('A','B','C','D')),
  echelle    SMALLINT NOT NULL CHECK (echelle BETWEEN 1 AND 3),
  grade      TEXT NOT NULL CHECK (grade IN ('INITIAL','INTERMEDIAIRE','TERMINAL_NORMAL','TERMINAL_EXCEPTIONNEL','HORS_CLASSE')),
  echelon    SMALLINT NOT NULL CHECK (echelon BETWEEN 1 AND 4),
  indice     INT,
  UNIQUE (categorie, echelle, grade, echelon)
);

-- ---------- 2. AGENTS ET COMPTES -------------------------------------

CREATE TABLE agents (
  id                 SERIAL PRIMARY KEY,
  matricule          TEXT UNIQUE NOT NULL,
  nom                TEXT NOT NULL,
  prenoms            TEXT NOT NULL,
  sexe               CHAR(1) CHECK (sexe IN ('M','F')),
  date_naissance     DATE,
  lieu_naissance     TEXT,
  telephone          TEXT,
  email              TEXT,
  statut_id          SMALLINT NOT NULL REFERENCES statuts_agent(id),
  structure_id       INT REFERENCES structures(id),
  -- ETAT : payé par l'État (pas de fiche de paie dans la plateforme)
  -- STRUCTURE : salaire financé par la structure (fiche de paie générée ici)
  financement        TEXT NOT NULL DEFAULT 'ETAT' CHECK (financement IN ('ETAT','STRUCTURE')),
  emploi             TEXT,
  grade_id           INT REFERENCES grades(id),           -- fonctionnaires
  salaire_base       NUMERIC(14,2),                       -- contractuels
  date_prise_service DATE NOT NULL,
  en_activite        BOOLEAN NOT NULL DEFAULT TRUE,
  banque_id          INT REFERENCES banques(id),
  rib                TEXT,
  ifu                TEXT,
  numero_cnss        TEXT,
  cree_le            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un compte indépendant par agent. Rôles : AGENT, RH, COMPTABLE, ADMIN.
CREATE TABLE comptes (
  id               SERIAL PRIMARY KEY,
  agent_id         INT UNIQUE REFERENCES agents(id),
  identifiant      TEXT UNIQUE NOT NULL,
  mot_de_passe_hash TEXT NOT NULL,                 -- jamais en clair (bcrypt via crypt())
  role             TEXT NOT NULL DEFAULT 'AGENT' CHECK (role IN ('AGENT','RH','COMPTABLE','ADMIN')),
  doit_changer_mdp BOOLEAN NOT NULL DEFAULT TRUE,
  actif            BOOLEAN NOT NULL DEFAULT TRUE,
  dernier_acces    TIMESTAMPTZ,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signature électronique du valideur (apposée sur les titres PDF)
CREATE TABLE signatures (
  id          SERIAL PRIMARY KEY,
  compte_id   INT NOT NULL REFERENCES comptes(id),
  fonction    TEXT NOT NULL,
  image_path  TEXT NOT NULL,
  actif       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- 3. RÈGLES DE CONGÉS ET D'ABSENCES -------------------------

CREATE TABLE types_absence (
  id        SERIAL PRIMARY KEY,
  code      TEXT UNIQUE NOT NULL,
  libelle   TEXT NOT NULL,
  famille   TEXT NOT NULL CHECK (famille IN ('CONGE','PERMISSION','ABSENCE')),
  justificatif_requis BOOLEAN NOT NULL DEFAULT FALSE
);

-- Une règle = (type d'absence, statut de l'agent). Les valeurs se
-- modifient sans toucher au code : c'est la table que la DRH administre.
CREATE TABLE regles_absence (
  id                      SERIAL PRIMARY KEY,
  type_id                 INT NOT NULL REFERENCES types_absence(id),
  statut_id               SMALLINT NOT NULL REFERENCES statuts_agent(id),
  duree_jours             INT,                  -- durée accordée par demande/événement
  duree_unite             TEXT NOT NULL DEFAULT 'JOURS_CALENDAIRES'
                          CHECK (duree_unite IN ('JOURS_CALENDAIRES','JOURS_OUVRABLES','SEMAINES','MOIS')),
  plafond_annuel_jours    INT,                  -- total max par année civile
  max_occurrences_annuel  INT,                  -- nombre de fois max par an (NULL = non limité)
  deduit_conge_annuel     BOOLEAN NOT NULL DEFAULT FALSE,
  delai_prescription_jours INT,                 -- demande à déposer dans les N jours suivant l'événement
  remuneration            TEXT NOT NULL DEFAULT 'PLEIN' CHECK (remuneration IN ('PLEIN','DEMI','NON')),
  base_legale             TEXT,
  a_verifier              BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (type_id, statut_id)
);

CREATE TABLE soldes (
  agent_id       INT NOT NULL REFERENCES agents(id),
  annee          INT NOT NULL,
  type_id        INT NOT NULL REFERENCES types_absence(id),
  acquis_jours   NUMERIC(6,1) NOT NULL DEFAULT 0,
  pris_jours     NUMERIC(6,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, annee, type_id)
);

-- ---------- 4. DEMANDES ET TITRES -------------------------------------

CREATE SEQUENCE seq_titre START 1;

CREATE TABLE demandes (
  id               SERIAL PRIMARY KEY,
  agent_id         INT NOT NULL REFERENCES agents(id),
  type_id          INT NOT NULL REFERENCES types_absence(id),
  date_debut       DATE NOT NULL,
  date_fin         DATE NOT NULL,
  nb_jours         INT NOT NULL,
  date_evenement   DATE,                         -- pour les permissions (prescription 30 j)
  motif            TEXT,
  justificatif_path TEXT,
  statut           TEXT NOT NULL DEFAULT 'SOUMISE'
                   CHECK (statut IN ('BROUILLON','SOUMISE','VALIDEE','REFUSEE','ANNULEE')),
  traite_par       INT REFERENCES comptes(id),
  traite_le        TIMESTAMPTZ,
  motif_refus      TEXT,
  numero_titre     TEXT UNIQUE,                  -- ex. 2026/0001, généré à la validation
  titre_pdf_path   TEXT,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut),
  CHECK (statut <> 'REFUSEE' OR motif_refus IS NOT NULL)
);
CREATE INDEX ON demandes (agent_id, statut);

-- Contrôle des règles à la soumission : plafond annuel, nombre de fois,
-- prescription, durée maximale par demande.
CREATE OR REPLACE FUNCTION controle_demande() RETURNS trigger AS $$
DECLARE r regles_absence%ROWTYPE; st SMALLINT; deja_jours INT; deja_fois INT;
BEGIN
  IF NEW.statut NOT IN ('SOUMISE','VALIDEE') THEN RETURN NEW; END IF;
  SELECT statut_id INTO st FROM agents WHERE id = NEW.agent_id;
  SELECT * INTO r FROM regles_absence WHERE type_id = NEW.type_id AND statut_id = st;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune règle définie pour ce type d''absence et ce statut d''agent';
  END IF;
  IF r.duree_jours IS NOT NULL AND r.duree_unite = 'JOURS_CALENDAIRES'
     AND r.plafond_annuel_jours IS NULL AND NEW.nb_jours > r.duree_jours THEN
    RAISE EXCEPTION 'Durée demandée (% j) supérieure à la durée autorisée (% j)', NEW.nb_jours, r.duree_jours;
  END IF;
  IF r.duree_jours IS NOT NULL AND NEW.nb_jours > r.duree_jours
     AND r.delai_prescription_jours IS NOT NULL THEN
    RAISE EXCEPTION 'Cette permission est limitée à % jour(s) par événement', r.duree_jours;
  END IF;
  IF r.delai_prescription_jours IS NOT NULL AND NEW.date_evenement IS NOT NULL
     AND NEW.date_debut > NEW.date_evenement + r.delai_prescription_jours THEN
    RAISE EXCEPTION 'Demande prescrite : à déposer dans les % jours suivant l''événement', r.delai_prescription_jours;
  END IF;
  SELECT COALESCE(SUM(nb_jours),0), COUNT(*) INTO deja_jours, deja_fois
    FROM demandes
   WHERE agent_id = NEW.agent_id AND type_id = NEW.type_id
     AND statut IN ('SOUMISE','VALIDEE') AND id IS DISTINCT FROM NEW.id
     AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM NEW.date_debut);
  IF r.plafond_annuel_jours IS NOT NULL AND deja_jours + NEW.nb_jours > r.plafond_annuel_jours THEN
    RAISE EXCEPTION 'Plafond annuel dépassé (% j sur % j)', deja_jours + NEW.nb_jours, r.plafond_annuel_jours;
  END IF;
  IF r.max_occurrences_annuel IS NOT NULL AND deja_fois + 1 > r.max_occurrences_annuel THEN
    RAISE EXCEPTION 'Nombre maximal de demandes atteint pour l''année (%)', r.max_occurrences_annuel;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_controle_demande
  BEFORE INSERT OR UPDATE OF statut, nb_jours, date_debut ON demandes
  FOR EACH ROW EXECUTE FUNCTION controle_demande();

-- Numéro de titre généré à la validation
CREATE OR REPLACE FUNCTION numerote_titre() RETURNS trigger AS $$
BEGIN
  IF NEW.statut = 'VALIDEE' AND NEW.numero_titre IS NULL THEN
    NEW.numero_titre := to_char(now(),'YYYY') || '/' || lpad(nextval('seq_titre')::text, 4, '0');
    NEW.traite_le := COALESCE(NEW.traite_le, now());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_numerote_titre
  BEFORE UPDATE ON demandes FOR EACH ROW EXECUTE FUNCTION numerote_titre();

-- ---------- 5. DOSSIER DU PERSONNEL (art. 13 et 104) -----------------

CREATE TABLE types_piece (
  id       SERIAL PRIMARY KEY,
  code     TEXT UNIQUE NOT NULL,
  libelle  TEXT NOT NULL,
  origine  TEXT NOT NULL CHECK (origine IN ('RECRUTEMENT','CARRIERE','GESTION'))
);

CREATE TABLE pieces_dossier (
  id             SERIAL PRIMARY KEY,
  agent_id       INT NOT NULL REFERENCES agents(id),
  type_piece_id  INT NOT NULL REFERENCES types_piece(id),
  intitule       TEXT,
  fichier_path   TEXT NOT NULL,
  date_acte      DATE,
  ajoute_par     INT REFERENCES comptes(id),
  ajoute_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON pieces_dossier (agent_id);

-- ---------- 6. PAIE ---------------------------------------------------

CREATE TABLE rubriques_paie (      -- sera calée sur le canevas officiel
  id       SERIAL PRIMARY KEY,
  code     TEXT UNIQUE NOT NULL,
  libelle  TEXT NOT NULL,
  sens     TEXT NOT NULL CHECK (sens IN ('GAIN','RETENUE')),
  imposable BOOLEAN NOT NULL DEFAULT TRUE,
  ordre    SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE periodes_paie (
  id        SERIAL PRIMARY KEY,
  annee     INT NOT NULL,
  mois      SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  statut    TEXT NOT NULL DEFAULT 'OUVERTE'
            CHECK (statut IN ('OUVERTE','EN_VERIFICATION','VALIDEE','PAYEE','CLOTUREE')),
  cloturee_par INT REFERENCES comptes(id),
  cloturee_le  TIMESTAMPTZ,
  UNIQUE (annee, mois)
);

-- Une ligne par agent et par mois. Le comptable décide : VALIDE ou SUSPENDU.
CREATE TABLE paies (
  id            SERIAL PRIMARY KEY,
  periode_id    INT NOT NULL REFERENCES periodes_paie(id),
  agent_id      INT NOT NULL REFERENCES agents(id),
  brut          NUMERIC(14,2) NOT NULL DEFAULT 0,
  retenues      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net           NUMERIC(14,2) GENERATED ALWAYS AS (brut - retenues) STORED,
  jours_absence_non_justifiee INT NOT NULL DEFAULT 0,
  decision      TEXT NOT NULL DEFAULT 'EN_ATTENTE' CHECK (decision IN ('EN_ATTENTE','VALIDE','SUSPENDU')),
  motif_suspension TEXT,
  decide_par    INT REFERENCES comptes(id),
  decide_le     TIMESTAMPTZ,
  banque_id     INT REFERENCES banques(id),       -- copie figée à la validation
  rib           TEXT,
  UNIQUE (periode_id, agent_id),
  CHECK (decision <> 'SUSPENDU' OR motif_suspension IS NOT NULL)
);

CREATE TABLE lignes_paie (
  id          SERIAL PRIMARY KEY,
  paie_id     INT NOT NULL REFERENCES paies(id) ON DELETE CASCADE,
  rubrique_id INT NOT NULL REFERENCES rubriques_paie(id),
  base        NUMERIC(14,2),
  taux        NUMERIC(8,4),
  montant     NUMERIC(14,2) NOT NULL
);

-- Une paie ne peut être créée que pour un agent financé par sa structure
CREATE OR REPLACE FUNCTION paie_reservee_structure() RETURNS trigger AS $$
BEGIN
  IF (SELECT financement FROM agents WHERE id = NEW.agent_id) <> 'STRUCTURE' THEN
    RAISE EXCEPTION 'Fiche de paie réservée aux agents financés par leur structure';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_paie_structure BEFORE INSERT ON paies FOR EACH ROW EXECUTE FUNCTION paie_reservee_structure();

-- Figer la banque et le RIB au moment de la validation
CREATE OR REPLACE FUNCTION fige_coordonnees_bancaires() RETURNS trigger AS $$
BEGIN
  IF NEW.decision = 'VALIDE' THEN
    SELECT banque_id, rib INTO NEW.banque_id, NEW.rib FROM agents WHERE id = NEW.agent_id;
    NEW.decide_le := COALESCE(NEW.decide_le, now());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fige_banque BEFORE INSERT OR UPDATE OF decision ON paies
  FOR EACH ROW EXECUTE FUNCTION fige_coordonnees_bancaires();

-- État de paiement par banque (à exporter en PDF/Excel par le comptable)
CREATE VIEW v_etat_paiement_banque AS
SELECT p.periode_id, pp.annee, pp.mois, b.nom AS banque,
       a.matricule, a.nom, a.prenoms, p.rib, p.net
  FROM paies p
  JOIN periodes_paie pp ON pp.id = p.periode_id
  JOIN agents a ON a.id = p.agent_id
  JOIN banques b ON b.id = p.banque_id
 WHERE p.decision = 'VALIDE'
 ORDER BY b.nom, a.nom;

CREATE VIEW v_total_par_banque AS
SELECT periode_id, banque, COUNT(*) AS nb_agents, SUM(net) AS total_net
  FROM v_etat_paiement_banque GROUP BY periode_id, banque;

-- L'agent ne voit que sa paie validée (utilisé par l'API, filtre sur agent_id)
CREATE VIEW v_mes_fiches_paie AS
SELECT p.id, p.agent_id, pp.annee, pp.mois, p.brut, p.retenues, p.net
  FROM paies p JOIN periodes_paie pp ON pp.id = p.periode_id
 WHERE p.decision = 'VALIDE' AND pp.statut IN ('VALIDEE','PAYEE','CLOTUREE');

-- ---------- 7. TRAÇABILITÉ -------------------------------------------

CREATE TABLE journal_audit (
  id         BIGSERIAL PRIMARY KEY,
  compte_id  INT REFERENCES comptes(id),
  action     TEXT NOT NULL,
  objet      TEXT,
  objet_id   TEXT,
  detail     JSONB,
  ip         INET,
  date_action TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sécurité au niveau des lignes : un agent n'accède qu'à ses propres données
ALTER TABLE demandes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pieces_dossier ENABLE ROW LEVEL SECURITY;
ALTER TABLE paies          ENABLE ROW LEVEL SECURITY;
-- (Politiques à créer avec le rôle applicatif : USING (agent_id = current_setting('app.agent_id')::int
--  OR current_setting('app.role') IN ('RH','COMPTABLE','ADMIN')) )

-- =====================================================================
-- DONNÉES DE BASE
-- =====================================================================

INSERT INTO statuts_agent (code, libelle, base_legale) VALUES
 ('FONCTIONNAIRE',   'Fonctionnaire de l''État',            'Loi 2015-18, art. 6'),
 ('ACE',             'Agent contractuel de l''État',        'Loi 2015-18, art. 7'),
 ('SOUS_CONTRACTUEL','Agent sous contrat de la structure',  'À préciser selon le contrat');

INSERT INTO types_absence (code, libelle, famille, justificatif_requis) VALUES
 ('CONGE_ANNUEL',      'Congé annuel',                                      'CONGE',      FALSE),
 ('CONGE_MALADIE',     'Congé de maladie',                                  'CONGE',      TRUE),
 ('CONGE_MATERNITE',   'Congé de maternité',                                'CONGE',      TRUE),
 ('CONGE_EXAMEN',      'Congé pour examen ou concours',                     'CONGE',      TRUE),
 ('PERM_DECES_MALADIE','Permission : décès ou maladie grave (conjoint, ascendant, descendant)', 'PERMISSION', TRUE),
 ('PERM_MARIAGE',      'Permission : mariage de l''agent',                  'PERMISSION', TRUE),
 ('PERM_MARIAGE_ENFANT','Permission : mariage d''un enfant',                'PERMISSION', TRUE),
 ('PERM_NAISSANCE',    'Permission : naissance au foyer',                   'PERMISSION', TRUE),
 ('AUTORISATION_ABS',  'Autorisation d''absence (autre motif)',             'ABSENCE',    FALSE);

-- Règles pour les FONCTIONNAIRES (loi 2015-18)
INSERT INTO regles_absence
 (type_id, statut_id, duree_jours, duree_unite, plafond_annuel_jours, max_occurrences_annuel, deduit_conge_annuel, delai_prescription_jours, remuneration, base_legale, a_verifier)
SELECT t.id, s.id, v.duree, v.unite, v.plafond, v.fois, v.deduit, v.presc, v.remu, v.art, v.verif
FROM (VALUES
 ('CONGE_ANNUEL',       30,   'JOURS_CALENDAIRES', 30,   NULL, FALSE, NULL, 'PLEIN', 'Art. 154 : 30 jours consécutifs par année de services ; jouissance sur 3 mois max', FALSE),
 ('PERM_DECES_MALADIE', 3,    'JOURS_CALENDAIRES', 10,   NULL, FALSE, 30,   'PLEIN', 'Art. 159 : 3 jours ; 10 jours/an max non déduits du congé annuel', FALSE),
 ('PERM_MARIAGE',       3,    'JOURS_CALENDAIRES', 10,   NULL, FALSE, 30,   'PLEIN', 'Art. 159 : 3 jours', FALSE),
 ('PERM_MARIAGE_ENFANT',1,    'JOURS_CALENDAIRES', 10,   NULL, FALSE, 30,   'PLEIN', 'Art. 159 : 1 jour', FALSE),
 ('PERM_NAISSANCE',     3,    'JOURS_CALENDAIRES', 10,   NULL, FALSE, 30,   'PLEIN', 'Art. 159 : 3 jours', FALSE),
 ('CONGE_MALADIE',      NULL, 'MOIS',              180,   NULL, FALSE, NULL, 'PLEIN', 'Art. 161 : 6 mois max sur 12 mois ; plein traitement 3 mois puis demi-traitement 3 mois (à gérer côté paie)', FALSE),
 ('CONGE_MATERNITE',    14,   'SEMAINES',          NULL, NULL, FALSE, NULL, 'PLEIN', 'Art. 169 : 14 semaines (6 avant, 8 après)', FALSE),
 ('CONGE_EXAMEN',       30,   'JOURS_CALENDAIRES', 30,   NULL, FALSE, NULL, 'PLEIN', 'Art. 176 : durée des épreuves + délais de route, 1 mois max', FALSE),
 ('AUTORISATION_ABS',   NULL, 'JOURS_CALENDAIRES', NULL, NULL, FALSE, NULL, 'PLEIN', 'À fixer par la DRH : nombre de fois / jours par an', TRUE)
) AS v(code, duree, unite, plafond, fois, deduit, presc, remu, art, verif)
JOIN types_absence t ON t.code = v.code
JOIN statuts_agent s ON s.code = 'FONCTIONNAIRE';

-- Règles PROVISOIRES pour contractuels et sous-contractuels : copie des
-- règles du fonctionnaire, à ajuster selon le contrat / décret applicable.
INSERT INTO regles_absence
 (type_id, statut_id, duree_jours, duree_unite, plafond_annuel_jours, max_occurrences_annuel,
  deduit_conge_annuel, delai_prescription_jours, remuneration, base_legale, a_verifier)
SELECT r.type_id, s.id, r.duree_jours, r.duree_unite, r.plafond_annuel_jours, r.max_occurrences_annuel,
       r.deduit_conge_annuel, r.delai_prescription_jours, r.remuneration,
       'PROVISOIRE (copie du statut fonctionnaire) — à confirmer', TRUE
FROM regles_absence r
JOIN statuts_agent f ON f.id = r.statut_id AND f.code = 'FONCTIONNAIRE'
JOIN statuts_agent s ON s.code IN ('ACE','SOUS_CONTRACTUEL');

INSERT INTO types_piece (code, libelle, origine) VALUES
 ('DEMANDE_NOMINATION','Demande de nomination ou d''engagement','RECRUTEMENT'),
 ('CERT_NATIONALITE',  'Certificat de nationalité','RECRUTEMENT'),
 ('FICHE_RENSEIGN',    'Fiche de renseignements','RECRUTEMENT'),
 ('ACTE_NAISSANCE',    'Extrait d''acte de naissance','RECRUTEMENT'),
 ('CASIER_JUDICIAIRE', 'Extrait de casier judiciaire','RECRUTEMENT'),
 ('SERVICE_MILITAIRE', 'État signalétique des services militaires','RECRUTEMENT'),
 ('CERT_MEDICAL',      'Certificat médical d''aptitude','RECRUTEMENT'),
 ('DIPLOME',           'Copie certifiée conforme du diplôme','RECRUTEMENT'),
 ('PRISE_SERVICE',     'Certificat de prise de service','RECRUTEMENT'),
 ('PHOTOS',            'Photos d''identité','RECRUTEMENT'),
 ('CODE_ETHIQUE',      'Engagement au Code des valeurs et d''éthique','RECRUTEMENT'),
 ('NOMINATION',        'Acte de nomination','CARRIERE'),
 ('TITULARISATION',    'Acte de titularisation','CARRIERE'),
 ('AVANCEMENT',        'Acte d''avancement ou de promotion','CARRIERE'),
 ('SANCTION',          'Acte portant sanction','CARRIERE'),
 ('RECOMPENSE',        'Acte portant récompense','CARRIERE'),
 ('CHANGEMENT_POSITION','Acte de changement de position','CARRIERE'),
 ('BULLETIN_NOTES',    'Bulletin de notes','CARRIERE'),
 ('TITRE_CONGE',       'Titre de congé','GESTION'),
 ('AFFECTATION',       'Acte d''affectation','GESTION'),
 ('AUTORISATION_ABSENCE','Autorisation d''absence','GESTION'),
 ('CONTRAT',           'Contrat de travail (contractuels)','RECRUTEMENT');

INSERT INTO rubriques_paie (code, libelle, sens, imposable, ordre) VALUES
 ('TRAITEMENT',  'Traitement indiciaire / salaire de base', 'GAIN', TRUE, 10),
 ('ALLOC_FAM',   'Allocations familiales',                  'GAIN', FALSE, 20),
 ('IND_RESID',   'Indemnité de résidence',                  'GAIN', TRUE, 30),
 ('IND_LOGEMENT','Indemnité de logement',                   'GAIN', TRUE, 40),
 ('PRIME_POSTE', 'Prime de fonction ou de poste et de résultats', 'GAIN', TRUE, 50),
 ('RETENUE_PENS','Retenue pour pension',                    'RETENUE', FALSE, 110),
 ('IMPOT',       'Impôt sur le traitement',                 'RETENUE', FALSE, 120);
