-- ============ Fase 2, Migración 2: catálogo GOV_PROCEDURE ============

-- 2.1 Stages ---------------------------------------------------------------
INSERT INTO public.workflow_stages_global
  (workflow_type, code, label, display_order, is_terminal, is_procedurally_live, legal_basis, is_system, active)
VALUES
 ('GOV_PROCEDURE','INDAGACION_PRELIMINAR','Averiguación preliminar',10,false,true,'CPACA art. 47 inc. 2 (facultativa)',true,true),
 ('GOV_PROCEDURE','MERITOS_COMUNICADOS','Mérito comunicado al interesado',20,false,true,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','CARGOS_FORMULADOS','Cargos formulados',30,false,true,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','CARGOS_NOTIFICADOS','Cargos notificados',40,false,true,'CPACA art. 47 (notificación personal; sin recursos)',true,true),
 ('GOV_PROCEDURE','TERMINO_DESCARGOS','En término de descargos',50,false,true,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS','Descargos presentados',60,false,true,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','PRUEBAS_DECRETADAS','Pruebas decretadas',70,false,true,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','PERIODO_PROBATORIO','Período probatorio',80,false,true,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','TRASLADO_ALEGATOS','Traslado para alegatos',90,false,true,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','ALEGATOS_PRESENTADOS','Alegatos presentados',100,false,true,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','PENDIENTE_DECISION','Pendiente de decisión de fondo',110,false,true,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','SANCION_IMPUESTA','Sanción impuesta',120,false,true,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','EXONERACION_ARCHIVO','Exoneración y archivo',130,true,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','DECISION_NOTIFICADA','Decisión notificada',140,false,true,'CPACA arts. 56, 67, 69',true,true),
 ('GOV_PROCEDURE','RECURSO_INTERPUESTO','Recurso interpuesto',150,false,true,'CPACA arts. 74, 76',true,true),
 ('GOV_PROCEDURE','RECURSO_RESUELTO','Recurso resuelto',160,false,true,'CPACA art. 74',true,true),
 ('GOV_PROCEDURE','SILENCIO_POSITIVO_RECURSO','Recurso fallado a favor por vencimiento',170,true,false,'CPACA art. 52 inc. 2',true,true),
 ('GOV_PROCEDURE','ACTO_EN_FIRME','Acto administrativo en firme',180,true,false,'CPACA art. 87',true,true),
 ('GOV_PROCEDURE','CADUCIDAD_FACULTAD_SANCIONATORIA','Caducidad de la facultad sancionatoria',190,true,false,'CPACA art. 52',true,true),
 ('GOV_PROCEDURE','SUSPENDIDO','Suspendido',200,false,true,'CPACA art. 47A / suspensión del trámite',true,true)
ON CONFLICT DO NOTHING;

-- 2.2 Transition graph -----------------------------------------------------
INSERT INTO public.workflow_stage_transitions
  (workflow_type, from_stage_code, to_stage_code, allowed_by_suggestion, requires_explicit_user_action, is_regression_allowed, legal_basis, is_system, active)
VALUES
 ('GOV_PROCEDURE','INDAGACION_PRELIMINAR','MERITOS_COMUNICADOS',true,false,false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','INDAGACION_PRELIMINAR','CARGOS_FORMULADOS',true,false,false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','MERITOS_COMUNICADOS','CARGOS_FORMULADOS',true,false,false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','CARGOS_FORMULADOS','CARGOS_NOTIFICADOS',true,false,false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','CARGOS_NOTIFICADOS','TERMINO_DESCARGOS',true,false,false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','TERMINO_DESCARGOS','DESCARGOS_PRESENTADOS',true,false,false,'CPACA art. 47',true,true),
 -- la ausencia de descargos no detiene el procedimiento
 ('GOV_PROCEDURE','TERMINO_DESCARGOS','PRUEBAS_DECRETADAS',true,false,false,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','TERMINO_DESCARGOS','PENDIENTE_DECISION',true,false,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS','PRUEBAS_DECRETADAS',true,false,false,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS','PENDIENTE_DECISION',true,false,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','PRUEBAS_DECRETADAS','PERIODO_PROBATORIO',true,false,false,'CPACA art. 48',true,true),
 -- alegatos SOLO desde el período probatorio (dependencia condicional, art. 48 inc. 2)
 ('GOV_PROCEDURE','PERIODO_PROBATORIO','TRASLADO_ALEGATOS',true,false,false,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','TRASLADO_ALEGATOS','ALEGATOS_PRESENTADOS',true,false,false,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','TRASLADO_ALEGATOS','PENDIENTE_DECISION',true,false,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','ALEGATOS_PRESENTADOS','PENDIENTE_DECISION',true,false,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','PENDIENTE_DECISION','SANCION_IMPUESTA',true,false,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','PENDIENTE_DECISION','EXONERACION_ARCHIVO',false,true,false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','SANCION_IMPUESTA','DECISION_NOTIFICADA',true,false,false,'CPACA arts. 56, 67, 69',true,true),
 ('GOV_PROCEDURE','DECISION_NOTIFICADA','RECURSO_INTERPUESTO',true,false,false,'CPACA arts. 74, 76',true,true),
 ('GOV_PROCEDURE','DECISION_NOTIFICADA','ACTO_EN_FIRME',false,true,false,'CPACA art. 87',true,true),
 ('GOV_PROCEDURE','RECURSO_INTERPUESTO','RECURSO_RESUELTO',true,false,false,'CPACA art. 74',true,true),
 ('GOV_PROCEDURE','RECURSO_INTERPUESTO','SILENCIO_POSITIVO_RECURSO',false,true,false,'CPACA art. 52 inc. 2',true,true),
 ('GOV_PROCEDURE','RECURSO_RESUELTO','ACTO_EN_FIRME',false,true,false,'CPACA art. 87',true,true),
 ('GOV_PROCEDURE','SUSPENDIDO','PENDIENTE_DECISION',true,false,true,'Reanudación del trámite',true,true)
ON CONFLICT DO NOTHING;

-- La caducidad y la suspensión pueden alcanzarse desde cualquier etapa viva,
-- pero sólo por acción explícita del usuario sobre una propuesta del sistema.
INSERT INTO public.workflow_stage_transitions
  (workflow_type, from_stage_code, to_stage_code, allowed_by_suggestion, requires_explicit_user_action, is_regression_allowed, legal_basis, is_system, active)
SELECT 'GOV_PROCEDURE', s.code, t.code, false, true, false,
       CASE t.code WHEN 'CADUCIDAD_FACULTAD_SANCIONATORIA' THEN 'CPACA art. 52' ELSE 'Suspensión del trámite' END,
       true, true
FROM public.workflow_stages_global s
CROSS JOIN (VALUES ('CADUCIDAD_FACULTAD_SANCIONATORIA'),('SUSPENDIDO')) AS t(code)
WHERE s.workflow_type = 'GOV_PROCEDURE' AND s.is_terminal = false AND s.code <> t.code
ON CONFLICT DO NOTHING;

-- 2.3 Event vocabulary -----------------------------------------------------
INSERT INTO public.workflow_event_catalog
  (workflow_type, code, label, description, event_kind, is_excluded_from_inference, legal_basis, is_system, active)
VALUES
 ('GOV_PROCEDURE','APERTURA_INDAGACION','Apertura de averiguación preliminar',NULL,'PROCEDURAL',false,'CPACA art. 47 inc. 2',true,true),
 ('GOV_PROCEDURE','COMUNICACION_MERITOS','Comunicación de méritos al interesado',NULL,'PROCEDURAL',false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','FORMULACION_CARGOS','Formulación de cargos',NULL,'PROCEDURAL',false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','NOTIFICACION_PERSONAL','Notificación personal',NULL,'PROCEDURAL',false,'CPACA art. 67',true,true),
 ('GOV_PROCEDURE','NOTIFICACION_AVISO','Notificación por aviso',NULL,'PROCEDURAL',false,'CPACA art. 69',true,true),
 ('GOV_PROCEDURE','NOTIFICACION_ELECTRONICA','Notificación electrónica',NULL,'PROCEDURAL',false,'CPACA art. 56',true,true),
 ('GOV_PROCEDURE','NOTIFICACION_CONDUCTA_CONCLUYENTE','Notificación por conducta concluyente',NULL,'PROCEDURAL',false,'CPACA art. 72',true,true),
 ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS','Presentación de descargos',NULL,'PROCEDURAL',false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','SOLICITUD_PRUEBAS','Solicitud de pruebas',NULL,'PROCEDURAL',false,'CPACA art. 47',true,true),
 ('GOV_PROCEDURE','DECRETO_PRUEBAS','Auto que decreta pruebas',NULL,'PROCEDURAL',false,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','PRORROGA_PROBATORIO','Prórroga del período probatorio',NULL,'PROCEDURAL',false,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','CIERRE_PROBATORIO','Cierre del período probatorio',NULL,'PROCEDURAL',false,'CPACA art. 48',true,true),
 ('GOV_PROCEDURE','TRASLADO_ALEGATOS','Traslado para alegatos',NULL,'PROCEDURAL',false,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','ALEGATOS_PRESENTADOS','Presentación de alegatos',NULL,'PROCEDURAL',false,'CPACA art. 48 inc. 2',true,true),
 ('GOV_PROCEDURE','RESOLUCION_SANCION','Resolución que impone sanción',NULL,'PROCEDURAL',false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','RESOLUCION_EXONERACION','Resolución de exoneración y archivo',NULL,'PROCEDURAL',false,'CPACA art. 49',true,true),
 ('GOV_PROCEDURE','RECURSO_REPOSICION','Interposición de recurso de reposición',NULL,'PROCEDURAL',false,'CPACA arts. 74, 76',true,true),
 ('GOV_PROCEDURE','RECURSO_APELACION','Interposición de recurso de apelación',NULL,'PROCEDURAL',false,'CPACA arts. 74, 76',true,true),
 ('GOV_PROCEDURE','RECURSO_QUEJA','Interposición de recurso de queja',NULL,'PROCEDURAL',false,'CPACA art. 74',true,true),
 ('GOV_PROCEDURE','RESOLUCION_RECURSO','Resolución que decide el recurso',NULL,'PROCEDURAL',false,'CPACA art. 74',true,true),
 ('GOV_PROCEDURE','CONSTANCIA_EJECUTORIA','Constancia de ejecutoria / firmeza',NULL,'PROCEDURAL',false,'CPACA art. 87',true,true),
 ('GOV_PROCEDURE','RENUENCIA_INFORMACION','Renuencia a suministrar información',NULL,'PROCEDURAL',false,'CPACA art. 51',true,true),
 ('GOV_PROCEDURE','SUSPENSION_PROVISIONAL','Suspensión provisional del servidor',NULL,'PROCEDURAL',false,'CPACA art. 47A (régimen fiscal)',true,true),
 ('GOV_PROCEDURE','COBRO_COACTIVO_INICIADO','Inicio de cobro coactivo',NULL,'PROCEDURAL',false,'Proceso distinto: vincular, nunca fusionar',true,true),
 ('GOV_PROCEDURE','ACUSE_RECIBO','Acuse de recibo automático',NULL,'NOISE',true,NULL,true,true),
 ('GOV_PROCEDURE','FUERA_DE_OFICINA','Respuesta automática de ausencia',NULL,'NOISE',true,NULL,true,true),
 ('GOV_PROCEDURE','CONFIRMACION_LECTURA','Confirmación de lectura',NULL,'NOISE',true,NULL,true,true)
ON CONFLICT DO NOTHING;

-- 2.4 Event → stage patterns (data-driven) ---------------------------------
INSERT INTO public.workflow_event_stage_patterns
  (workflow_type, event_code, pattern_keywords, base_confidence, priority, suggested_stage_code, is_excluded, is_system, active)
VALUES
 ('GOV_PROCEDURE','APERTURA_INDAGACION', ARRAY['averiguacion preliminar','indagacion preliminar','auto de averiguacion'],0.70,10,'INDAGACION_PRELIMINAR',false,true,true),
 ('GOV_PROCEDURE','COMUNICACION_MERITOS', ARRAY['comunicacion de meritos','merito para formular cargos'],0.70,20,'MERITOS_COMUNICADOS',false,true,true),
 ('GOV_PROCEDURE','FORMULACION_CARGOS', ARRAY['pliego de cargos','formulacion de cargos','formula cargos'],0.85,30,'CARGOS_FORMULADOS',false,true,true),
 ('GOV_PROCEDURE','NOTIFICACION_PERSONAL', ARRAY['notificacion personal','constancia de notificacion personal'],0.80,40,'CARGOS_NOTIFICADOS',false,true,true),
 ('GOV_PROCEDURE','NOTIFICACION_AVISO', ARRAY['notificacion por aviso','aviso de notificacion'],0.75,41,'CARGOS_NOTIFICADOS',false,true,true),
 ('GOV_PROCEDURE','NOTIFICACION_ELECTRONICA', ARRAY['notificacion electronica','notificacion por correo electronico'],0.75,42,'CARGOS_NOTIFICADOS',false,true,true),
 ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS', ARRAY['escrito de descargos','presenta descargos','radica descargos'],0.80,50,'DESCARGOS_PRESENTADOS',false,true,true),
 ('GOV_PROCEDURE','DECRETO_PRUEBAS', ARRAY['decreta pruebas','auto de pruebas','apertura a pruebas'],0.80,60,'PRUEBAS_DECRETADAS',false,true,true),
 ('GOV_PROCEDURE','CIERRE_PROBATORIO', ARRAY['cierre del periodo probatorio','vencido el periodo probatorio'],0.70,70,'PERIODO_PROBATORIO',false,true,true),
 ('GOV_PROCEDURE','TRASLADO_ALEGATOS', ARRAY['traslado para alegar','alegatos de conclusion','traslado para alegatos'],0.80,80,'TRASLADO_ALEGATOS',false,true,true),
 ('GOV_PROCEDURE','ALEGATOS_PRESENTADOS', ARRAY['presenta alegatos','escrito de alegatos'],0.80,90,'ALEGATOS_PRESENTADOS',false,true,true),
 ('GOV_PROCEDURE','RESOLUCION_SANCION', ARRAY['impone sancion','resolucion sancionatoria','declara responsable'],0.85,100,'SANCION_IMPUESTA',false,true,true),
 ('GOV_PROCEDURE','RESOLUCION_EXONERACION', ARRAY['exonera','archiva las diligencias','ordena el archivo'],0.85,110,'EXONERACION_ARCHIVO',false,true,true),
 ('GOV_PROCEDURE','RECURSO_REPOSICION', ARRAY['recurso de reposicion'],0.80,120,'RECURSO_INTERPUESTO',false,true,true),
 ('GOV_PROCEDURE','RECURSO_APELACION', ARRAY['recurso de apelacion'],0.80,121,'RECURSO_INTERPUESTO',false,true,true),
 ('GOV_PROCEDURE','RECURSO_QUEJA', ARRAY['recurso de queja'],0.80,122,'RECURSO_INTERPUESTO',false,true,true),
 ('GOV_PROCEDURE','RESOLUCION_RECURSO', ARRAY['resuelve el recurso','confirma la resolucion','revoca la resolucion'],0.80,130,'RECURSO_RESUELTO',false,true,true),
 ('GOV_PROCEDURE','CONSTANCIA_EJECUTORIA', ARRAY['constancia de ejecutoria','quedo en firme','acto en firme'],0.80,140,'ACTO_EN_FIRME',false,true,true),
 ('GOV_PROCEDURE','RENUENCIA_INFORMACION', ARRAY['renuencia','se abstuvo de suministrar informacion'],0.60,150,NULL,false,true,true),
 ('GOV_PROCEDURE','SUSPENSION_PROVISIONAL', ARRAY['suspension provisional del servidor'],0.60,160,'SUSPENDIDO',false,true,true),
 ('GOV_PROCEDURE','ACUSE_RECIBO', ARRAY['acuse de recibo','automatic reply','respuesta automatica','no responder a este correo'],0.00,900,NULL,true,true,true),
 ('GOV_PROCEDURE','FUERA_DE_OFICINA', ARRAY['fuera de la oficina','out of office','vacaciones'],0.00,901,NULL,true,true,true),
 ('GOV_PROCEDURE','CONFIRMACION_LECTURA', ARRAY['confirmacion de lectura','read receipt'],0.00,902,NULL,true,true,true)
ON CONFLICT DO NOTHING;

-- 2.5 Regimes (overlays) ---------------------------------------------------
INSERT INTO public.gov_procedure_regimes (code,label,legal_basis,verified,requires_manual_review,contested_points,notes)
VALUES
 ('CPACA_GENERAL','Procedimiento administrativo sancionatorio general','Ley 1437 de 2011, arts. 47–52',true,false,
   '["Art. 52 inc. 2: el silencio positivo del recurso desplaza al silencio negativo general del art. 86; punto discutido — exige confirmación manual antes de proponer etapa terminal."]'::jsonb,
   'Régimen supletorio por defecto (arts. 34 y 47 inc. 1).'),
 ('SANCIONATORIO_FISCAL','Sancionatorio fiscal','Ley 2080 de 2021 (arts. 47 par., 47A, 48 par., 49 par., 49A)',false,true,'[]'::jsonb,
   'Desviaciones declaradas y NO verificadas artículo por artículo: descargos 5 días; probatorio ≤10 días (≤30 con 3+ investigados o prueba en el exterior); traslado de alegatos 5 días; decisión 15 días; recursos 5 días; suspensión provisional del servidor (art. 47A). Sin plazos calculables hasta verificación.'),
 ('AMBIENTAL','Sancionatorio ambiental','Ley 1333 de 2009',false,true,'[]'::jsonb,'Procedimiento propio; CPACA supletorio. Sin términos verificados.'),
 ('TRANSITO','Contravencional de tránsito','Ley 769 de 2002 / Ley 1383 de 2010',false,true,'[]'::jsonb,'Procedimiento propio; un comparendo es un perfil más, nunca el modelo. Sin términos verificados.')
ON CONFLICT (code) DO NOTHING;

-- 2.6 CPACA_GENERAL terms --------------------------------------------------
INSERT INTO public.gov_procedure_regime_terms
 (regime_code,deadline_type,label,duration_value,day_type,anchor_kind,anchor_event_code,max_extension_value,extension_condition,norma,requires_manual_review,is_background_timer,notes)
VALUES
 ('CPACA_GENERAL','GOV_DESCARGOS','Término de descargos',15,'BUSINESS','NOTIFICATION','FORMULACION_CARGOS',NULL,NULL,'CPACA art. 47',false,false,NULL),
 ('CPACA_GENERAL','GOV_PERIODO_PROBATORIO','Período probatorio',30,'BUSINESS','ISSUANCE','DECRETO_PRUEBAS',60,'Tres o más investigados o prueba que deba practicarse en el exterior','CPACA art. 48',false,false,NULL),
 ('CPACA_GENERAL','GOV_TRASLADO_ALEGATOS','Traslado para alegatos',10,'BUSINESS','TERM_EXPIRY','CIERRE_PROBATORIO',NULL,NULL,'CPACA art. 48 inc. 2',false,false,'Condicional: sólo si hubo período probatorio.'),
 ('CPACA_GENERAL','GOV_DECISION_FONDO','Decisión de fondo',30,'BUSINESS','FILING_DATE','ALEGATOS_PRESENTADOS',NULL,NULL,'CPACA art. 49',false,false,NULL),
 ('CPACA_GENERAL','GOV_RECURSOS','Término para interponer recursos',10,'BUSINESS','NOTIFICATION','RESOLUCION_SANCION',NULL,NULL,'CPACA arts. 74 y 76',false,false,NULL),
 ('CPACA_GENERAL','GOV_CADUCIDAD_SANCIONATORIA','Caducidad de la facultad sancionatoria',3,'YEARS','FACT_DATE',NULL,NULL,NULL,'CPACA art. 52',false,true,'Se satisface sólo con la NOTIFICACIÓN del acto sancionatorio, no con su expedición. Conducta continuada: se re-ancla al día siguiente de la cesación.'),
 ('CPACA_GENERAL','GOV_RECURSO_UN_ANO','Decisión del recurso (1 año, so pena de pérdida de competencia)',1,'YEARS','FILING_DATE',NULL,NULL,NULL,'CPACA art. 52 inc. 2',false,true,'Vencido, el recurso se entiende fallado a favor del recurrente.')
ON CONFLICT (regime_code,deadline_type) DO NOTHING;

-- 2.7 Unverified overlays: declared but non-computable terms ---------------
INSERT INTO public.gov_procedure_regime_terms
 (regime_code,deadline_type,label,duration_value,day_type,anchor_kind,norma,requires_manual_review,notes)
VALUES
 ('SANCIONATORIO_FISCAL','GOV_DESCARGOS','Término de descargos (declarado: 5 días)',NULL,'BUSINESS','NOTIFICATION',NULL,true,'Ley 2080 de 2021 — pendiente de verificación artículo por artículo.'),
 ('SANCIONATORIO_FISCAL','GOV_PERIODO_PROBATORIO','Período probatorio (declarado: ≤10 días, ≤30 excepcional)',NULL,'BUSINESS','ISSUANCE',NULL,true,'Pendiente de verificación.'),
 ('SANCIONATORIO_FISCAL','GOV_TRASLADO_ALEGATOS','Traslado para alegatos (declarado: 5 días)',NULL,'BUSINESS','TERM_EXPIRY',NULL,true,'Pendiente de verificación.'),
 ('SANCIONATORIO_FISCAL','GOV_DECISION_FONDO','Decisión de fondo (declarado: 15 días)',NULL,'BUSINESS','FILING_DATE',NULL,true,'Pendiente de verificación.'),
 ('SANCIONATORIO_FISCAL','GOV_RECURSOS','Término para recursos (declarado: 5 días)',NULL,'BUSINESS','NOTIFICATION',NULL,true,'Ley 2080, art. 49A — pendiente de verificación.')
ON CONFLICT (regime_code,deadline_type) DO NOTHING;

-- 2.8 Stage applicability per regime --------------------------------------
INSERT INTO public.gov_procedure_regime_stage_applicability (regime_code, stage_code, applicability)
SELECT r.code, s.code,
  CASE WHEN s.code IN ('INDAGACION_PRELIMINAR','MERITOS_COMUNICADOS','PRUEBAS_DECRETADAS','PERIODO_PROBATORIO',
                       'TRASLADO_ALEGATOS','ALEGATOS_PRESENTADOS','RECURSO_INTERPUESTO','RECURSO_RESUELTO',
                       'SILENCIO_POSITIVO_RECURSO','SUSPENDIDO')
       THEN 'CONDITIONAL' ELSE 'UNIVERSAL' END
FROM public.gov_procedure_regimes r
CROSS JOIN public.workflow_stages_global s
WHERE s.workflow_type = 'GOV_PROCEDURE'
ON CONFLICT (regime_code, stage_code) DO NOTHING;

-- 2.9 Execution-path rules (default = CPACA_GENERAL) -----------------------
INSERT INTO public.deadline_rules
 (workflow_type,deadline_type,days_amount,day_type,norma,description,requires_manual_review,is_active,term_class,anchor_kind)
VALUES
 ('GOV_PROCEDURE','GOV_DESCARGOS',15,'BUSINESS','CPACA art. 47','Descargos, 15 días hábiles desde la notificación de la formulación de cargos',false,true,'ADMINISTRATIVO','NOTIFICATION'),
 ('GOV_PROCEDURE','GOV_PERIODO_PROBATORIO',30,'BUSINESS','CPACA art. 48','Período probatorio, hasta 30 días hábiles (60 excepcionales)',false,true,'ADMINISTRATIVO','ISSUANCE'),
 ('GOV_PROCEDURE','GOV_TRASLADO_ALEGATOS',10,'BUSINESS','CPACA art. 48 inc. 2','Traslado para alegatos, 10 días hábiles desde el vencimiento del probatorio',false,true,'ADMINISTRATIVO','TERM_EXPIRY'),
 ('GOV_PROCEDURE','GOV_DECISION_FONDO',30,'BUSINESS','CPACA art. 49','Decisión de fondo, 30 días hábiles desde la presentación de alegatos',false,true,'ADMINISTRATIVO','FILING_DATE'),
 ('GOV_PROCEDURE','GOV_RECURSOS',10,'BUSINESS','CPACA arts. 74 y 76','Recursos, 10 días hábiles desde la notificación',false,true,'ADMINISTRATIVO','NOTIFICATION'),
 ('GOV_PROCEDURE','GOV_CADUCIDAD_SANCIONATORIA',3,'YEARS','CPACA art. 52','Caducidad de la facultad sancionatoria, 3 años desde el hecho',false,true,'ADMINISTRATIVO','FACT_DATE'),
 ('GOV_PROCEDURE','GOV_RECURSO_UN_ANO',1,'YEARS','CPACA art. 52 inc. 2','Un año para decidir el recurso, so pena de pérdida de competencia',false,true,'ADMINISTRATIVO','FILING_DATE')
ON CONFLICT DO NOTHING;

-- 2.10 GOV_PROCEDURE becomes catalog-governed ------------------------------
UPDATE public.workflow_definitions
   SET catalog_governed = true,
       legal_basis = 'Ley 1437 de 2011, arts. 34 y 47–52 (procedimiento administrativo sancionatorio; régimen supletorio)',
       label = COALESCE(label,'Procedimiento administrativo sancionatorio')
 WHERE workflow_type = 'GOV_PROCEDURE';