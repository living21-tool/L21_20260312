'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function p(id: string, sc: string, name: string, desc: string, locId: string, beds: number, type = 'wohnung') {
  return {
    id, name, short_code: sc, aliases: [] as string[], type, location_id: locId,
    beds, price_per_bed_night: 0, cleaning_fee: 0, description: desc,
    amenities: [] as string[], images: [] as string[], active: true,
  }
}

const locs = [
  { id: 'loc-berlin',  name: 'Berlin',               city: 'Berlin',              country: 'Deutschland', color: '#3B82F6' },
  { id: 'loc-brb',     name: 'Brandenburg',           city: 'Brandenburg',         country: 'Deutschland', color: '#10B981' },
  { id: 'loc-nrw',     name: 'NRW Aachen',            city: 'Aachen',              country: 'Deutschland', color: '#8B5CF6' },
  { id: 'loc-mgl',     name: 'NRW Mönchengladbach',  city: 'Mönchengladbach',     country: 'Deutschland', color: '#F59E0B' },
  { id: 'loc-dus',     name: 'NRW Düsseldorf',        city: 'Düsseldorf',          country: 'Deutschland', color: '#EF4444' },
  { id: 'loc-neuss',   name: 'NRW Neuss',             city: 'Neuss',               country: 'Deutschland', color: '#06B6D4' },
  { id: 'loc-do',      name: 'NRW Dortmund',          city: 'Dortmund',            country: 'Deutschland', color: '#84CC16' },
  { id: 'loc-mh',      name: 'NRW Mülheim',           city: 'Mülheim an der Ruhr', country: 'Deutschland', color: '#F97316' },
  { id: 'loc-le',      name: 'Leipzig',               city: 'Leipzig',             country: 'Deutschland', color: '#14B8A6' },
  { id: 'loc-dd',      name: 'Dresden',               city: 'Dresden',             country: 'Deutschland', color: '#EC4899' },
  { id: 'loc-fl',      name: 'Flensburg',             city: 'Flensburg',           country: 'Deutschland', color: '#6366F1' },
]

const allProperties = [
  // Berlin
  p('prop-001','FST4',       'Florastr. 4',                     'Florastr. 4, 13187 Berlin',                       'loc-berlin', 14),
  p('prop-002','EBD90',      'Eichborndamm 90',                 'Eichborndamm 90, 13403 Berlin',                   'loc-berlin',  7),
  p('prop-003','B311 WE42',  'Brunsbütteler Damm 311 · WE 42', 'Brunsbütteler Damm 311, 13591 Berlin',            'loc-berlin',  2),
  p('prop-004','FBS11',      'Friedrichsbrunner Str. 11',       'Friedrichsbrunner Str. 11, 12347 Berlin',         'loc-berlin',  5),
  p('prop-005','H57d',       'Hindenburgdamm 57d',              'Hindenburgdamm 57d, 12203 Berlin',                'loc-berlin',  3),
  // Brandenburg
  p('prop-006','BST122',       'Bernauer Str. 122, Oranienburg',   'Bernauer Str. 122, 16515 Oranienburg',            'loc-brb',  4),
  p('prop-007','ADS19 WE5',    'An den Schäferpfühlen 19 · WE 5', 'An den Schäferpfühlen 19, 16321 Bernau',          'loc-brb',  6),
  p('prop-008','ODS23 Aufg1',  'Oderstr. 23 · Aufg. 1',           'Oderstr. 23, 14513 Teltow',                       'loc-brb', 14),
  p('prop-009','ODS23 Zi3',    'Oderstr. 23 · Zi. 3',             'Oderstr. 23, 14513 Teltow',                       'loc-brb',  1, 'zimmer'),
  p('prop-010','ODS23 Zi4',    'Oderstr. 23 · Zi. 4',             'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-011','ODS23 Zi7',    'Oderstr. 23 · Zi. 7',             'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-012','ODS23 Zi8',    'Oderstr. 23 · Zi. 8',             'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-013','ODS23 Zi9',    'Oderstr. 23 · Zi. 9',             'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-014','ODS23 Zi11',   'Oderstr. 23 · Zi. 11',            'Oderstr. 23, 14513 Teltow',                       'loc-brb',  4, 'zimmer'),
  p('prop-015','ODS23 Zi12',   'Oderstr. 23 · Zi. 12',            'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-016','ODS23 Zi13',   'Oderstr. 23 · Zi. 13',            'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-017','ODS23 Zi16',   'Oderstr. 23 · Zi. 16',            'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-018','ODS23 Zi17',   'Oderstr. 23 · Zi. 17',            'Oderstr. 23, 14513 Teltow',                       'loc-brb',  2, 'zimmer'),
  p('prop-019','D25c',         'Dorfstr. 25c, Zeuthen',            'Dorfstr. 25c, 15738 Zeuthen',                     'loc-brb',  4),
  p('prop-020','KWS3',         'Königs Wusterhausener Str. 3',     'Königs Wusterhausener Str. 3, 12529 Schönefeld',  'loc-brb',  4),
  p('prop-021','WAK7',         'Weg am Krankenhaus 7, KW',         'Weg am Krankenhaus 7, 15711 Königs Wusterhausen', 'loc-brb',  4),
  p('prop-022','TS15 WE1',     'Thaerstr. 15 · WE 1, Potsdam',    'Thaerstr. 15, 14469 Potsdam',                     'loc-brb',  5),
  p('prop-023','TS15 WE2',     'Thaerstr. 15 · WE 2, Potsdam',    'Thaerstr. 15, 14469 Potsdam',                     'loc-brb',  5),
  p('prop-024','PST17 WE1',    'Poststr. 17 · WE 1, Beelitz',     'Poststr. 17, 14547 Beelitz',                      'loc-brb',  6),
  p('prop-025','PST17 WE2',    'Poststr. 17 · WE 2, Beelitz',     'Poststr. 17, 14547 Beelitz',                      'loc-brb',  5),
  p('prop-026','PST17 Zi401',  'Poststr. 17 · Zi. 401',           'Poststr. 17, 14547 Beelitz',                      'loc-brb',  2, 'zimmer'),
  p('prop-027','PST17 Zi402',  'Poststr. 17 · Zi. 402',           'Poststr. 17, 14547 Beelitz',                      'loc-brb',  2, 'zimmer'),
  p('prop-028','PST17 Zi403',  'Poststr. 17 · Zi. 403',           'Poststr. 17, 14547 Beelitz',                      'loc-brb',  2, 'zimmer'),
  p('prop-029','PST17 Zi404',  'Poststr. 17 · Zi. 404',           'Poststr. 17, 14547 Beelitz',                      'loc-brb',  2, 'zimmer'),
  p('prop-030','PST17 Zi405',  'Poststr. 17 · Zi. 405',           'Poststr. 17, 14547 Beelitz',                      'loc-brb',  2, 'zimmer'),
  p('prop-031','PST17 WE5',    'Poststr. 17 · WE 5, Beelitz',     'Poststr. 17, 14547 Beelitz',                      'loc-brb',  4),
  p('prop-032','GTP10 WE2',    'Goethepl. 10 · WE 2, Fürstenwalde', 'Goethepl. 10, 15517 Fürstenwalde',              'loc-brb',  3),
  p('prop-033','GTP10 WE15',   'Goethepl. 10 · WE 15, Fürstenwalde','Goethepl. 10, 15517 Fürstenwalde',             'loc-brb',  2),
  // NRW Aachen
  p('prop-034','JK19 WE1',   'Jakobstr. 19 · WE 1, Alsdorf',  'Jakobstr. 19, 52477 Alsdorf',  'loc-nrw',  3),
  p('prop-035','JK19 WE2',   'Jakobstr. 19 · WE 2, Alsdorf',  'Jakobstr. 19, 52477 Alsdorf',  'loc-nrw',  2),
  p('prop-036','JK19 WE3',   'Jakobstr. 19 · WE 3, Alsdorf',  'Jakobstr. 19, 52477 Alsdorf',  'loc-nrw',  6),
  p('prop-037','JK19 WE4',   'Jakobstr. 19 · WE 4, Alsdorf',  'Jakobstr. 19, 52477 Alsdorf',  'loc-nrw',  4),
  p('prop-038','JK19 WE5',   'Jakobstr. 19 · WE 5, Alsdorf',  'Jakobstr. 19, 52477 Alsdorf',  'loc-nrw',  6),
  p('prop-039','JK19a WE6',  'Jakobstr. 19a · WE 6, Alsdorf', 'Jakobstr. 19a, 52477 Alsdorf', 'loc-nrw', 12),
  p('prop-040','PST33 WE2',  'Poststr. 33 · WE 2, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  3),
  p('prop-041','PST33 WE4',  'Poststr. 33 · WE 4, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  6),
  p('prop-042','PST33 WE5',  'Poststr. 33 · WE 5, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  3),
  p('prop-043','PST33 WE6',  'Poststr. 33 · WE 6, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  6),
  p('prop-044','PST33 WE7',  'Poststr. 33 · WE 7, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  6),
  p('prop-045','PST33 WE8',  'Poststr. 33 · WE 8, Alsdorf',   'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  3),
  p('prop-046','PST33 WE11', 'Poststr. 33 · WE 11, Alsdorf',  'Poststr. 33, 52477 Alsdorf',   'loc-nrw',  4),
  p('prop-047','HCH22 WE2',  'Hochstr. 22 · WE 2, Geilenkirchen', 'Hochstr. 22, 52511 Geilenkirchen', 'loc-nrw', 5),
  p('prop-048','HCH22 WE3',  'Hochstr. 22 · WE 3, Geilenkirchen', 'Hochstr. 22, 52511 Geilenkirchen', 'loc-nrw', 6),
  p('prop-049','HCH22 WE4',  'Hochstr. 22 · WE 4, Geilenkirchen', 'Hochstr. 22, 52511 Geilenkirchen', 'loc-nrw', 6),
  p('prop-050','HCH22 WE5',  'Hochstr. 22 · WE 5, Geilenkirchen', 'Hochstr. 22, 52511 Geilenkirchen', 'loc-nrw', 7),
  p('prop-051','HCH22 WE6',  'Hochstr. 22 · WE 6, Geilenkirchen', 'Hochstr. 22, 52511 Geilenkirchen', 'loc-nrw', 6),
  p('prop-052','BPS13 WE1',  'BPS13 · WE 1', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-053','BPS13 WE2',  'BPS13 · WE 2', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-054','BPS15 WE1',  'BPS15 · WE 1', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-055','BPS15 WE2',  'BPS15 · WE 2', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-056','BPS15 WE3',  'BPS15 · WE 3', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-057','BPS15 WE4',  'BPS15 · WE 4', 'NRW Aachen', 'loc-nrw', 6),
  p('prop-058','BPS15 WE6',  'BPS15 · WE 6', 'NRW Aachen', 'loc-nrw', 6),
  // Mönchengladbach
  p('prop-059','AB21',         'AB21, Mönchengladbach',   'Mönchengladbach', 'loc-mgl', 10),
  p('prop-060','BBS6 WE1',     'BBS6 · WE 1',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-061','BBS6 WE3',     'BBS6 · WE 3',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-062','BBS6 WE5',     'BBS6 · WE 5',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-063','BBS6 WE6',     'BBS6 · WE 6',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-064','KTS37 WE1',    'KTS37 · WE 1',            'Mönchengladbach', 'loc-mgl',  4),
  p('prop-065','MST323 WE2',   'MST323 · WE 2',           'Mönchengladbach', 'loc-mgl',  4),
  p('prop-066','MST323 WE3',   'MST323 · WE 3',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-067','MST323 WE4',   'MST323 · WE 4',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-068','MST323 WE5',   'MST323 · WE 5',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-069','MST323 WE6',   'MST323 · WE 6',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-070','MST323 WE7',   'MST323 · WE 7',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-071','MST323 WE8',   'MST323 · WE 8',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-072','FHS145 WE1',   'FHS145 · WE 1',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-073','FHS145 WE5',   'FHS145 · WE 5',           'Mönchengladbach', 'loc-mgl',  4),
  p('prop-074','FHS145 WE6',   'FHS145 · WE 6',           'Mönchengladbach', 'loc-mgl',  6),
  p('prop-075','FHS145 WE7',   'FHS145 · WE 7',           'Mönchengladbach', 'loc-mgl',  5),
  p('prop-076','TH8 WE1',      'TH8 · WE 1',              'Mönchengladbach', 'loc-mgl',  3),
  p('prop-077','TH8 WE2',      'TH8 · WE 2',              'Mönchengladbach', 'loc-mgl',  6),
  p('prop-078','TH8 WE3',      'TH8 · WE 3',              'Mönchengladbach', 'loc-mgl',  3),
  p('prop-079','TH8 WE4',      'TH8 · WE 4',              'Mönchengladbach', 'loc-mgl',  6),
  p('prop-080','TH8 WE5',      'TH8 · WE 5',              'Mönchengladbach', 'loc-mgl',  3),
  p('prop-081','TH8 WE6',      'TH8 · WE 6',              'Mönchengladbach', 'loc-mgl',  6),
  p('prop-082','CCS7 WE1',     'CCS7 · WE 1',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-083','CCS7 WE2',     'CCS7 · WE 2',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-084','CCS7 WE3',     'CCS7 · WE 3',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-085','CCS7 WE4',     'CCS7 · WE 4',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-086','CCS7 WE5',     'CCS7 · WE 5',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-087','CCS7 WE6',     'CCS7 · WE 6',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-088','CCS7 WE7',     'CCS7 · WE 7',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-089','CCS7 WE8',     'CCS7 · WE 8',             'Mönchengladbach', 'loc-mgl',  3),
  p('prop-090','CCS9 WE1',     'CCS9 · WE 1',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-091','CCS9 WE4',     'CCS9 · WE 4',             'Mönchengladbach', 'loc-mgl',  4),
  p('prop-092','CCS9 WE5',     'CCS9 · WE 5',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-093','CCS9 WE7',     'CCS9 · WE 7',             'Mönchengladbach', 'loc-mgl',  6),
  p('prop-094','CCS9 WE8',     'CCS9 · WE 8',             'Mönchengladbach', 'loc-mgl',  6),
  // Düsseldorf
  p('prop-095','EM22 WE1',   'EM22 · WE 1, Düsseldorf',  'Düsseldorf', 'loc-dus', 7),
  p('prop-096','EM22 WE3',   'EM22 · WE 3, Düsseldorf',  'Düsseldorf', 'loc-dus', 6),
  p('prop-097','EM22 WE5',   'EM22 · WE 5, Düsseldorf',  'Düsseldorf', 'loc-dus', 6),
  p('prop-098','EM22 WE11',  'EM22 · WE 11, Düsseldorf', 'Düsseldorf', 'loc-dus', 3),
  // Neuss
  p('prop-099','BP1 WE13',  'BP1 · WE 13, Neuss',  'Neuss', 'loc-neuss', 6),
  p('prop-100','BP3 WE12',  'BP3 · WE 12, Neuss',  'Neuss', 'loc-neuss', 5),
  p('prop-101','BP3 WE14',  'BP3 · WE 14, Neuss',  'Neuss', 'loc-neuss', 7),
  p('prop-102','D80 WE19',  'D80 · WE 19, Neuss',  'Neuss', 'loc-neuss', 5),
  p('prop-103','D80 WE20',  'D80 · WE 20, Neuss',  'Neuss', 'loc-neuss', 6),
  p('prop-104','D80 WE32',  'D80 · WE 32, Neuss',  'Neuss', 'loc-neuss', 4),
  p('prop-105','FS133 WE5', 'FS133 · WE 5, Neuss', 'Neuss', 'loc-neuss', 5),
  // Dortmund
  p('prop-106','SBS34',      'SBS34, Dortmund',  'Dortmund', 'loc-do', 12),
  p('prop-107','RLD6 WE1',   'RLD6 · WE 1',      'Dortmund', 'loc-do',  3),
  p('prop-108','RLD6 WE2',   'RLD6 · WE 2',      'Dortmund', 'loc-do',  3),
  p('prop-109','RLD6 WE3',   'RLD6 · WE 3',      'Dortmund', 'loc-do',  4),
  p('prop-110','RLD6 WE4',   'RLD6 · WE 4',      'Dortmund', 'loc-do',  2),
  p('prop-111','RLD6 WE5',   'RLD6 · WE 5',      'Dortmund', 'loc-do',  6),
  p('prop-112','RLD6 WE6',   'RLD6 · WE 6',      'Dortmund', 'loc-do',  3),
  p('prop-113','RLD6 WE7',   'RLD6 · WE 7',      'Dortmund', 'loc-do',  3),
  p('prop-114','RLD6 WE8',   'RLD6 · WE 8',      'Dortmund', 'loc-do',  3),
  p('prop-115','RLD6 WE9',   'RLD6 · WE 9',      'Dortmund', 'loc-do',  2),
  p('prop-116','RLD6 WE10',  'RLD6 · WE 10',     'Dortmund', 'loc-do',  6),
  p('prop-117','RLD6 WE11',  'RLD6 · WE 11',     'Dortmund', 'loc-do',  3),
  p('prop-118','RLD6 WE12',  'RLD6 · WE 12',     'Dortmund', 'loc-do',  3),
  p('prop-119','RLD6 WE14',  'RLD6 · WE 14',     'Dortmund', 'loc-do',  2),
  p('prop-120','RLD6 WE16',  'RLD6 · WE 16',     'Dortmund', 'loc-do',  3),
  p('prop-121','RLD6 WE18',  'RLD6 · WE 18',     'Dortmund', 'loc-do',  3),
  p('prop-122','RLD6 WE20',  'RLD6 · WE 20',     'Dortmund', 'loc-do',  6),
  p('prop-123','RLD6 WE21',  'RLD6 · WE 21',     'Dortmund', 'loc-do',  3),
  p('prop-124','RLD6 WE22',  'RLD6 · WE 22',     'Dortmund', 'loc-do',  3),
  p('prop-125','RLD6 WE23',  'RLD6 · WE 23',     'Dortmund', 'loc-do',  6),
  p('prop-126','RLD6 WE26',  'RLD6 · WE 26',     'Dortmund', 'loc-do',  4),
  p('prop-127','RLD6 WE27',  'RLD6 · WE 27',     'Dortmund', 'loc-do',  3),
  p('prop-128','RLD6 WE28',  'RLD6 · WE 28',     'Dortmund', 'loc-do',  3),
  p('prop-129','RLD6 WE29',  'RLD6 · WE 29',     'Dortmund', 'loc-do',  3),
  p('prop-130','RLD6 WE30',  'RLD6 · WE 30',     'Dortmund', 'loc-do',  4),
  p('prop-131','RLD6 WE31',  'RLD6 · WE 31',     'Dortmund', 'loc-do',  4),
  p('prop-132','RLD6 WE32',  'RLD6 · WE 32',     'Dortmund', 'loc-do',  3),
  p('prop-133','RLD6 WE35',  'RLD6 · WE 35',     'Dortmund', 'loc-do',  2),
  p('prop-134','RLD6 WE36',  'RLD6 · WE 36',     'Dortmund', 'loc-do',  4),
  p('prop-135','RLD6 WE37',  'RLD6 · WE 37',     'Dortmund', 'loc-do',  3),
  p('prop-136','RLD6 WE39',  'RLD6 · WE 39',     'Dortmund', 'loc-do',  3),
  p('prop-137','RLD6 WE40',  'RLD6 · WE 40',     'Dortmund', 'loc-do',  3),
  p('prop-138','RLD6 WE41',  'RLD6 · WE 41',     'Dortmund', 'loc-do',  3),
  p('prop-139','RLD6 WE45',  'RLD6 · WE 45',     'Dortmund', 'loc-do',  2),
  p('prop-140','RLD6 WE46',  'RLD6 · WE 46',     'Dortmund', 'loc-do',  4),
  p('prop-141','RLD6 WE47',  'RLD6 · WE 47',     'Dortmund', 'loc-do',  3),
  p('prop-142','RLD6 WE48',  'RLD6 · WE 48',     'Dortmund', 'loc-do',  4),
  p('prop-143','RLD6 WE50',  'RLD6 · WE 50',     'Dortmund', 'loc-do',  3),
  // Mülheim (WE1-WE28, je 4 Betten)
  ...Array.from({ length: 28 }, (_, i) => {
    const n  = i + 1
    const id = `prop-${String(143 + n).padStart(3, '0')}`
    return p(id, `SST4 WE${n}`, `SST4 · WE ${n}, Mülheim`, 'Mülheim an der Ruhr', 'loc-mh', 4)
  }),
  // Leipzig
  p('prop-172','DL61 WE6',   'DL61 · WE 6, Leipzig',  'Leipzig', 'loc-le', 5),
  p('prop-173','DL61 WE8',   'DL61 · WE 8, Leipzig',  'Leipzig', 'loc-le', 6),
  p('prop-174','DL63 WE12',  'DL63 · WE 12, Leipzig', 'Leipzig', 'loc-le', 6),
  p('prop-175','DL63 WE13',  'DL63 · WE 13, Leipzig', 'Leipzig', 'loc-le', 6),
  p('prop-176','DL63 WE16',  'DL63 · WE 16, Leipzig', 'Leipzig', 'loc-le', 6),
  p('prop-177','AH8 WE4',    'AH8 · WE 4, Leipzig',   'Leipzig', 'loc-le', 4),
  p('prop-178','JP13 WE1',   'JP13 · WE 1, Leipzig',  'Leipzig', 'loc-le', 8),
  p('prop-179','JP13 WE2',   'JP13 · WE 2, Leipzig',  'Leipzig', 'loc-le', 8),
  p('prop-180','JP13 WE8',   'JP13 · WE 8, Leipzig',  'Leipzig', 'loc-le', 3),
  p('prop-181','VS6a WE1',   'VS6a · WE 1, Leipzig',  'Leipzig', 'loc-le', 5),
  p('prop-182','VS6a WE2',   'VS6a · WE 2, Leipzig',  'Leipzig', 'loc-le', 5),
  p('prop-183','VS6a WE14',  'VS6a · WE 14, Leipzig', 'Leipzig', 'loc-le', 6),
  // Dresden
  p('prop-184','KB40a WE4',  'KB40a · WE 4, Dresden',  'Dresden', 'loc-dd', 3),
  p('prop-185','KB40b WE14', 'KB40b · WE 14, Dresden', 'Dresden', 'loc-dd', 5),
  p('prop-186','KB40b WE15', 'KB40b · WE 15, Dresden', 'Dresden', 'loc-dd', 2),
  p('prop-187','KB40b WE17', 'KB40b · WE 17, Dresden', 'Dresden', 'loc-dd', 5),
  p('prop-188','WS22 WE8',   'WS22 · WE 8, Dresden',   'Dresden', 'loc-dd', 6),
  // Flensburg
  p('prop-189','GS33 WE3', 'GS33 · WE 3, Flensburg', 'Flensburg', 'loc-fl',  7),
  p('prop-190','GS33 WE4', 'GS33 · WE 4, Flensburg', 'Flensburg', 'loc-fl',  7),
  p('prop-191','GS33 WE5', 'GS33 · WE 5, Flensburg', 'Flensburg', 'loc-fl',  5),
  p('prop-192','GS33 WE6', 'GS33 · WE 6, Flensburg', 'Flensburg', 'loc-fl',  6),
  p('prop-193','GS33 WE7', 'GS33 · WE 7, Flensburg', 'Flensburg', 'loc-fl',  2),
  p('prop-194','SG11 WE2', 'SG11 · WE 2, Flensburg', 'Flensburg', 'loc-fl', 14),
  p('prop-195','SG11 WE3', 'SG11 · WE 3, Flensburg', 'Flensburg', 'loc-fl',  7),
  p('prop-196','SG11 WE4', 'SG11 · WE 4, Flensburg', 'Flensburg', 'loc-fl',  5),
  p('prop-197','SG11 WE5', 'SG11 · WE 5, Flensburg', 'Flensburg', 'loc-fl',  4),
]

type Step = 'idle' | 'locations' | 'properties' | 'done' | 'error'

export default function SeedPage() {
  const router  = useRouter()
  const [step,    setStep]    = useState<Step>('idle')
  const [error,   setError]   = useState<string>('')
  const [counts,  setCounts]  = useState({ locs: 0, props: 0, beds: 0 })

  useEffect(() => {
    async function run() {
      try {
        // 1. Standorte
        setStep('locations')
        const { error: locErr } = await supabase.from('locations').upsert(locs)
        if (locErr) throw locErr

        // 2. Objekte (in Batches à 50)
        setStep('properties')
        const BATCH = 50
        for (let i = 0; i < allProperties.length; i += BATCH) {
          const batch = allProperties.slice(i, i + BATCH)
          const { error: propErr } = await supabase.from('properties').upsert(batch)
          if (propErr) throw propErr
        }

        const beds = allProperties.reduce((s, p) => s + p.beds, 0)
        setCounts({ locs: locs.length, props: allProperties.length, beds })
        setStep('done')
        setTimeout(() => router.push('/objekte'), 2500)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStep('error')
      }
    }
    run()
  }, [router])

  const stepLabel: Record<Step, string> = {
    idle:       'Wird vorbereitet…',
    locations:  '11 Standorte werden gespeichert…',
    properties: '197 Objekte werden gespeichert…',
    done:       'Fertig!',
    error:      'Fehler aufgetreten',
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-10 text-center max-w-sm w-full">
        {step !== 'done' && step !== 'error' && (
          <>
            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <span className="text-2xl">⚙️</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Daten werden nach Supabase geladen</h2>
            <p className="text-sm text-slate-500">{stepLabel[step]}</p>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✅</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">In Supabase gespeichert!</h2>
            <div className="grid grid-cols-3 gap-3 my-4">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">Standorte</p>
                <p className="text-2xl font-bold text-slate-900">{counts.locs}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">Objekte</p>
                <p className="text-2xl font-bold text-slate-900">{counts.props}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">Betten</p>
                <p className="text-2xl font-bold text-slate-900">{counts.beds}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400">Weiterleitung zu Objekte…</p>
          </>
        )}

        {step === 'error' && (
          <>
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">❌</span>
            </div>
            <h2 className="text-lg font-bold text-red-600 mb-2">Fehler</h2>
            <p className="text-sm text-slate-500 mb-4 break-all">{error}</p>
            <p className="text-xs text-slate-400">Hast du das SQL-Schema bereits in Supabase ausgeführt?</p>
          </>
        )}
      </div>
    </div>
  )
}
