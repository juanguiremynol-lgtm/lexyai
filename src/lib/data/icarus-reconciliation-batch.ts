// Hard-coded reference batch of 31 ICARUS radicados for reconciliation.
// Source of truth for the bulk-import UI under /admin/import-work-items.

import type { BatchItem } from "@/lib/icarus-reconciliation/types";

export const ICARUS_RECONCILIATION_BATCH: BatchItem[] = [
  { radicado: "05001333300320190025200", despacho: "Juzgado 003 Administrativo Medellín", demandantes: ["Sebastian Ramirez Castaño"], demandados: ["Gobernacion de Antioquia"], suggested_workflow_type: "CPACA" },
  { radicado: "05001400302820260052100", despacho: "Juzgado 028 Civil Municipal Medellín", demandantes: ["Luca Daniel Tofan"], demandados: ["Jairo Ochoa y CIA Ltda"], suggested_workflow_type: "CGP" },
  { radicado: "05001310302120250021100", despacho: "Juzgado 021 Civil del Circuito Medellín", demandantes: ["Octavio de Jesus Agudelo Piedrahita"], demandados: ["Olga Lucia Londoño Sierra"], suggested_workflow_type: "CGP" },
  { radicado: "05001233300020240115300", despacho: "Tribunal Administrativo Medellín", demandantes: ["Juan Guillermo Restrepo Maya"], demandados: ["CORNARE", "ICA", "Municipio El Retiro"], suggested_workflow_type: "CPACA" },
  { radicado: "05001400303520260059400", despacho: "Juzgado 035 Civil Municipal Medellín", demandantes: ["Martha Celleny Gaviria Hernandez"], demandados: ["Fundacion Oasis Universal"], suggested_workflow_type: "CGP" },
  { radicado: "05001400301120240210000", despacho: "Juzgado 011 Civil Municipal Medellín", demandantes: ["Isabel Victoria Olave Patiño"], demandados: ["ORT Oasis Group S.A.S."], suggested_workflow_type: "CGP" },
  { radicado: "05001400302020250187800", despacho: "Juzgado 020 Civil Municipal Medellín", demandantes: ["Miriam del Socorro Garcia de Betancur"], demandados: ["Libardo Asdrubal Betancur y otros"], suggested_workflow_type: "CGP" },
  { radicado: "05001400300520260018300", despacho: "Juzgado 005 Civil Municipal Medellín", demandantes: ["Yolanda de Jesús Arenas"], demandados: ["Luz Adriana Zapata Vargas"], suggested_workflow_type: "CGP" },
  { radicado: "05001333301020230019900", despacho: "Juzgado 010 Administrativo Medellín", demandantes: ["Multiple demandantes"], demandados: ["Fiduciaria Central S.A.", "Distrito de Medellín y otros"], suggested_workflow_type: "CPACA" },
  { radicado: "05001400302020260045500", despacho: "Juzgado 020 Civil Municipal Medellín", demandantes: ["Daniel Fernando Sanabria Toro"], demandados: ["Portada Inmobiliaria S.A.S."], suggested_workflow_type: "CGP" },
  { radicado: "05001400300120250154400", despacho: "Juzgado 001 Civil Municipal Medellín", demandantes: ["G+A Graficos S.A.S"], demandados: ["Esfinge Group S.A.S"], suggested_workflow_type: "CGP" },
  { radicado: "11001310301820260008200", despacho: "Juzgado 018 Civil Circuito Bogotá", demandantes: ["Alvaro Leal Perez"], demandados: ["La Previsora S.A. Compañia de Seguros"], suggested_workflow_type: "CGP" },
  { radicado: "05001311000220260018500", despacho: "Juzgado 002 de Familia Medellín", demandantes: ["Laura Hoyos Bejarano"], demandados: ["Jony Andrey Hoyos Henao"], suggested_workflow_type: "CGP" },
  { radicado: "05001333300520250001900", despacho: "Juzgado 005 Administrativo Medellín", demandantes: ["Beatriz Elena Ruiz Gonzalez"], demandados: ["Municipio de El Retiro"], suggested_workflow_type: "CPACA" },
  { radicado: "05030318900120250000200", despacho: "Juzgado 001 Promiscuo Circuito Amagá", demandantes: ["Erco Energía SAS ESP"], demandados: ["Multiple demandados"], suggested_workflow_type: "CGP" },
  { radicado: "11001418904220250174800", despacho: "Juzgado 024 Civil Circuito Bogotá", demandantes: ["Gloria Helena Castrillon Urrego"], demandados: ["G4S Secure Solutions Colombia S.A."], suggested_workflow_type: "CGP" },
  { radicado: "11001311001320260014900", despacho: "Juzgado 013 de Familia Bogotá", demandantes: ["Luis Armando Cerón Escorcia"], demandados: ["Sandra Milena Bayona Díaz"], suggested_workflow_type: "CGP" },
  { radicado: "11001333704320260004700", despacho: "Juzgado 043 Administrativo Sección Cuarta Bogotá", demandantes: ["Nucleotecnica Ltda"], demandados: ["Municipio de Soacha"], suggested_workflow_type: "CPACA" },
  { radicado: "05001400302320250063800", despacho: "Juzgado 023 Civil Municipal Medellín", demandantes: ["Herederos de Jairo de Jesús Restrepo Posada"], demandados: ["Gloria Elena Henao Henao", "Patricia Restrepo Henao"], suggested_workflow_type: "CGP" },
  { radicado: "05001333303320240007800", despacho: "Tribunal Administrativo Medellín", demandantes: ["Juan Guillermo Restrepo Maya"], demandados: ["Municipio de El Retiro"], suggested_workflow_type: "CPACA" },
  { radicado: "66001418900120260031700", despacho: "Juzgado 001 Pequeñas Causas Pereira", demandantes: ["Conjunto Cerrado Pinar de Belmonte P.H."], demandados: ["Diana Carolina Cortes Lopez"], suggested_workflow_type: "CGP" },
  { radicado: "05001400301520240193000", despacho: "Juzgado 015 Civil Municipal Medellín", demandantes: ["Veronica Ortiz Castro"], demandados: ["Santiago Matias"], suggested_workflow_type: "CGP" },
  { radicado: "05001333301020240013900", despacho: "Juzgado 010 Administrativo Medellín", demandantes: ["Wilson Eduardo Ramirez Osorio"], demandados: ["Municipio de Liborina"], suggested_workflow_type: "CPACA" },
  { radicado: "05001333300320250013300", despacho: "Juzgado 003 Administrativo Medellín", demandantes: ["Juan Guillermo Restrepo Maya"], demandados: ["Municipio de Rionegro"], suggested_workflow_type: "CPACA" },
  { radicado: "05001310301420260005900", despacho: "Juzgado 014 Civil Circuito Medellín", demandantes: ["Martha Celenny Gaviria Hernández"], demandados: ["Fundacion Oasis Universal"], suggested_workflow_type: "CGP" },
  { radicado: "05001310300520260012300", despacho: "Juzgado 005 Civil Circuito Medellín", demandantes: ["Beatriz Elena Ruiz Gonzalez", "Michelle Allen Ruiz"], demandados: ["Empresas Publicas de Medellín"], suggested_workflow_type: "CGP" },
  { radicado: "05001400300220250105400", despacho: "Juzgado 002 Civil Municipal Medellín", demandantes: ["Johana Andrea Marin Jaramillo"], demandados: ["Bancolombia"], suggested_workflow_type: "CGP" },
  // La Ceja items: court name says "Asuntos Laborales" but cases are civil; stay as CGP.
  { radicado: "05376311200120230029200", despacho: "Juzgado 001 Civil Circuito Asuntos Laborales La Ceja", demandantes: ["Angela Maria Martinez Ruiz y otros"], demandados: ["Luz Marina Martinez Ruiz y otros"], suggested_workflow_type: "CGP" },
  { radicado: "05001333301820200006500", despacho: "Tribunal Administrativo Medellín", demandantes: ["Juan Guillermo Restrepo Maya"], demandados: ["Municipio de El Retiro"], suggested_workflow_type: "CPACA" },
  { radicado: "05376311200120230031400", despacho: "Juzgado 001 Civil Circuito Asuntos Laborales La Ceja", demandantes: ["Jaime Leon Arcila Rueda"], demandados: ["Conbloque Constructores SAS"], suggested_workflow_type: "CGP" },
  { radicado: "05376311200120220031700", despacho: "Juzgado 001 Civil Circuito Asuntos Laborales La Ceja", demandantes: ["Luz Teresa Valencia Arango y otros"], demandados: ["Diana Marcela Mejia Castro y otros"], suggested_workflow_type: "CGP" },
];

/** Radicados confirmed missing from work_items at planning time. */
export const MISSING_RADICADOS: ReadonlyArray<string> = [
  "05001400303520260059400",
  "05001400300520260018300",
  "11001310301820260008200",
  "66001418900120260031700",
  "05001310300520260012300",
];