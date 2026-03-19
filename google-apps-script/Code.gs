/**
 * ============================================================
 *  F-Jugend Sommer-Cup – Google Apps Script Backend
 *  Kopiere diesen Code vollständig in den Google Apps Script
 *  Editor (script.google.com) und deploye ihn als Web App.
 * ============================================================
 *
 *  Sheet-Struktur:
 *    config    – tournamentName | tournamentDate | logoClub | logoSponsor1 | logoSponsor2
 *    teams     – id | name | gruppe
 *    matchesP1 – group | round | field | homeId | awayId | scoreH | scoreA
 *    matchesP2 – group | round | field | homeId | awayId | scoreH | scoreA
 *    helfer    – schicht | aufgabe | name | kind | email | timestamp
 *    aufgaben  – item | wer
 */

// ──────────────────────────────────────────────────────────────
// HTTP ENTRY POINTS
// ──────────────────────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  if (action === 'get_tournament_data') {
    return getTournamentData();
  }

  return jsonError('Unbekannte Aktion: ' + action);
}

function doPost(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || '';

  if (action === 'update_score') {
    return updateScore(params);
  }
  if (action === 'register_helper') {
    return registerHelper(params);
  }
  if (action === 'claim_task') {
    return claimTask(params);
  }
  if (action === 'unclaim_task') {
    return unclaimTask(params);
  }
  if (action === 'generate_hauptrunde') {
    return generateHauptrunde();
  }

  return jsonError('Unbekannte Aktion: ' + action);
}

// ──────────────────────────────────────────────────────────────
// GET TOURNAMENT DATA
// ──────────────────────────────────────────────────────────────

function getTournamentData() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var config   = readConfig(ss);
    var teams    = readSheet(ss, 'teams',    ['id','name','gruppe']);
    var matchesP1 = readSheet(ss, 'matchesP1', ['group','round','field','homeId','awayId','scoreH','scoreA']);
    var matchesP2 = readSheet(ss, 'matchesP2', ['group','round','field','homeId','awayId','scoreH','scoreA']);
    var helfer   = readSheet(ss, 'helfer',   ['schicht','aufgabe','name','kind','email','timestamp']);
    var aufgaben = readSheet(ss, 'aufgaben', ['item','wer']);

    return jsonSuccess({
      config:    config,
      teams:     teams,
      matchesP1: matchesP1,
      matchesP2: matchesP2,
      helfer:    helfer,
      aufgaben:  aufgaben
    });
  } catch (err) {
    return jsonError('getTournamentData: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// UPDATE SCORE
// ──────────────────────────────────────────────────────────────

function updateScore(params) {
  try {
    var phase  = params.phase  || '';   // 'p1' or 'p2'
    var homeId = String(params.homeId || '');
    var awayId = String(params.awayId || '');
    var group  = String(params.group  || '');
    var round  = String(params.round  || '');
    var field  = String(params.field  || '');
    var scoreH = params.scoreH;
    var scoreA = params.scoreA;

    if (scoreH === '' || scoreH === undefined || scoreA === '' || scoreA === undefined) {
      return jsonError('Fehlende Ergebnisse');
    }

    var sheetName = (phase === 'p2') ? 'matchesP2' : 'matchesP1';
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return jsonError('Sheet nicht gefunden: ' + sheetName);

    var data    = sheet.getDataRange().getValues();
    var headers = data[0]; // group | round | field | homeId | awayId | scoreH | scoreA
    var iGroup  = headers.indexOf('group');
    var iRound  = headers.indexOf('round');
    var iField  = headers.indexOf('field');
    var iHomeId = headers.indexOf('homeId');
    var iAwayId = headers.indexOf('awayId');
    var iScoreH = headers.indexOf('scoreH');
    var iScoreA = headers.indexOf('scoreA');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (
        String(row[iGroup])  === group  &&
        String(row[iRound])  === round  &&
        String(row[iField])  === field  &&
        String(row[iHomeId]) === homeId &&
        String(row[iAwayId]) === awayId
      ) {
        sheet.getRange(i + 1, iScoreH + 1).setValue(Number(scoreH));
        sheet.getRange(i + 1, iScoreA + 1).setValue(Number(scoreA));
        return jsonSuccess({ updated: true });
      }
    }

    return jsonError('Spiel nicht gefunden');
  } catch (err) {
    return jsonError('updateScore: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// REGISTER HELPER
// ──────────────────────────────────────────────────────────────

function registerHelper(params) {
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var sheet  = ss.getSheetByName('helfer');
    if (!sheet) return jsonError('Sheet "helfer" nicht gefunden');

    var schicht  = params.schicht  || '';
    var aufgabe  = params.aufgabe  || '';
    var name     = params.name     || '';
    var kind     = params.kind     || '';
    var email    = params.email    || '';
    var timestamp = new Date().toISOString();

    sheet.appendRow([schicht, aufgabe, name, kind, email, timestamp]);
    return jsonSuccess({ registered: true });
  } catch (err) {
    return jsonError('registerHelper: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// CLAIM / UNCLAIM TASK
// ──────────────────────────────────────────────────────────────

function claimTask(params) {
  try {
    var taskName   = params.taskName   || '';
    var personName = params.personName || '';
    if (!taskName || !personName) return jsonError('taskName und personName erforderlich');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('aufgaben');
    if (!sheet) return jsonError('Sheet "aufgaben" nicht gefunden');

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var iItem   = headers.indexOf('item');
    var iWer    = headers.indexOf('wer');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][iItem]) === taskName) {
        sheet.getRange(i + 1, iWer + 1).setValue(personName);
        return jsonSuccess({ claimed: true });
      }
    }
    return jsonError('Aufgabe nicht gefunden: ' + taskName);
  } catch (err) {
    return jsonError('claimTask: ' + err.message);
  }
}

function unclaimTask(params) {
  try {
    var taskName = params.taskName || '';
    if (!taskName) return jsonError('taskName erforderlich');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('aufgaben');
    if (!sheet) return jsonError('Sheet "aufgaben" nicht gefunden');

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var iItem   = headers.indexOf('item');
    var iWer    = headers.indexOf('wer');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][iItem]) === taskName) {
        sheet.getRange(i + 1, iWer + 1).setValue('');
        return jsonSuccess({ unclaimed: true });
      }
    }
    return jsonError('Aufgabe nicht gefunden: ' + taskName);
  } catch (err) {
    return jsonError('unclaimTask: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// GENERATE HAUPTRUNDE  ← NEU
// ──────────────────────────────────────────────────────────────

/**
 * Berechnet aus den Vorrunden-Ergebnissen (matchesP1) die Tabellen
 * der vier Vorrunden-Gruppen (A–D), bildet daraus die fünf
 * Hauptrunden-Leveling-Gruppen (1–5) und schreibt den fertigen
 * Spielplan in das matchesP2-Sheet.
 *
 * Aufruf via POST: action=generate_hauptrunde
 *
 * Hauptrunden-Gruppen:
 *   1 (Rot)    – alle Erstplatzierten    aus A, B, C, D
 *   2 (Blau)   – alle Zweitplatzierten   aus A, B, C, D
 *   3 (Grün)   – alle Drittplatzierten   aus A, B, C, D
 *   4 (Gelb)   – alle Viertplatzierten   aus A, B, C, D
 *   5 (Orange) – alle Fünftplatzierten   aus A, B, C, D
 *
 * Spielplan (Runden 11–18, 4 Felder):
 *   R11: Grp1 Spieltag1 (F1+2),  Grp2 Spieltag1 (F3+4)
 *   R12: Grp3 Spieltag1 (F1+2),  Grp4 Spieltag1 (F3+4)
 *   R13: Grp5 Spieltag1 (F1+2),  Grp1 Spieltag2 (F3+4)
 *   R14: Grp5 Spieltag2 (F1+2),  Grp2 Spieltag2 (F3+4)
 *   R15: Grp5 Spieltag3 (F1+2),  Grp3 Spieltag2 (F3+4)
 *   R16: Grp1 Spieltag3 (F1+2),  Grp4 Spieltag2 (F3+4)
 *   R17: Grp2 Spieltag3 (F1+2),  Grp3 Spieltag3 (F3+4)
 *   R18: Grp4 Spieltag3 (F1+2)   – nur 2 Felder belegt
 */
function generateHauptrunde() {
  try {
    var ss         = SpreadsheetApp.getActiveSpreadsheet();
    var p1Sheet    = ss.getSheetByName('matchesP1');
    var p2Sheet    = ss.getSheetByName('matchesP2');
    var teamsSheet = ss.getSheetByName('teams');

    if (!p1Sheet)    return jsonError('Sheet "matchesP1" nicht gefunden');
    if (!p2Sheet)    return jsonError('Sheet "matchesP2" nicht gefunden');
    if (!teamsSheet) return jsonError('Sheet "teams" nicht gefunden');

    // ── 1. Teams einlesen ────────────────────────────────────
    var teamsData = teamsSheet.getDataRange().getValues();
    // Erwartete Spaltenreihenfolge: id | name | gruppe
    // Robust auch bei abweichender Reihenfolge:
    var tHeaders = teamsData[0];
    var tId      = tHeaders.indexOf('id');
    var tName    = tHeaders.indexOf('name');
    var tGruppe  = tHeaders.indexOf('gruppe');
    if (tId < 0 || tName < 0 || tGruppe < 0) {
      return jsonError('teams-Sheet: Spalten "id", "name", "gruppe" erwartet');
    }

    var teamMap = {}; // teamId (String) -> { id, name, gruppe }
    for (var i = 1; i < teamsData.length; i++) {
      var tr = teamsData[i];
      if (tr[tId] === '' || tr[tId] === null || tr[tId] === undefined) continue;
      var tid = String(tr[tId]);
      teamMap[tid] = { id: tid, name: String(tr[tName]), gruppe: String(tr[tGruppe]) };
    }

    // ── 2. Vorrunden-Ergebnisse einlesen ─────────────────────
    var p1Data    = p1Sheet.getDataRange().getValues();
    var p1Headers = p1Data[0];
    var c = {
      group:  p1Headers.indexOf('group'),
      homeId: p1Headers.indexOf('homeId'),
      awayId: p1Headers.indexOf('awayId'),
      scoreH: p1Headers.indexOf('scoreH'),
      scoreA: p1Headers.indexOf('scoreA')
    };
    if (c.group < 0 || c.homeId < 0 || c.awayId < 0 || c.scoreH < 0 || c.scoreA < 0) {
      return jsonError('matchesP1-Sheet: Spalten "group","homeId","awayId","scoreH","scoreA" erwartet');
    }

    var matches = [];
    var missingScores = 0;
    for (var i = 1; i < p1Data.length; i++) {
      var row = p1Data[i];
      if (!row[c.group] || !row[c.homeId]) continue; // Leerzeile überspringen
      var sh = row[c.scoreH];
      var sa = row[c.scoreA];
      if (sh === '' || sh === null || sh === undefined ||
          sa === '' || sa === null || sa === undefined) {
        missingScores++;
        continue;
      }
      matches.push({
        group:  String(row[c.group]),
        homeId: String(row[c.homeId]),
        awayId: String(row[c.awayId]),
        scoreH: Number(sh),
        scoreA: Number(sa)
      });
    }

    if (missingScores > 0) {
      return jsonError(
        'Nicht alle Vorrunden-Spiele wurden eingetragen. ' +
        'Es fehlen noch ' + missingScores + ' Ergebnisse.'
      );
    }

    // ── 3. Tabellen berechnen (DFB-Sortierung) ───────────────
    var vorrundeGruppen = ['A', 'B', 'C', 'D'];

    /**
     * DFB-Sortierung:
     *   1. Punkte absteigend  (Sieg=3, Unentschieden=1, Niederlage=0)
     *   2. Tordifferenz absteigend
     *   3. Geschossene Tore absteigend
     *   4. Teamname alphabetisch aufsteigend
     */
    function calcTable(groupLetter) {
      // Teams dieser Gruppe initialisieren
      var table = {};
      Object.keys(teamMap).forEach(function(tid) {
        if (teamMap[tid].gruppe === groupLetter) {
          table[tid] = {
            id:           tid,
            name:         teamMap[tid].name,
            points:       0,
            goalsFor:     0,
            goalsAgainst: 0,
            played:       0
          };
        }
      });

      // Ergebnisse einrechnen
      matches.forEach(function(m) {
        if (m.group !== groupLetter) return;
        var home = table[m.homeId];
        var away = table[m.awayId];
        if (!home || !away) return;

        home.played++;
        away.played++;
        home.goalsFor     += m.scoreH;
        home.goalsAgainst += m.scoreA;
        away.goalsFor     += m.scoreA;
        away.goalsAgainst += m.scoreH;

        if (m.scoreH > m.scoreA) {
          home.points += 3;
        } else if (m.scoreH < m.scoreA) {
          away.points += 3;
        } else {
          home.points += 1;
          away.points += 1;
        }
      });

      // Sortierung
      var rows = Object.values(table);
      rows.sort(function(a, b) {
        if (b.points !== a.points) return b.points - a.points;
        var dA = a.goalsFor - a.goalsAgainst;
        var dB = b.goalsFor - b.goalsAgainst;
        if (dB !== dA) return dB - dA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name, 'de');
      });

      return rows; // index 0 = Platz 1
    }

    var groupStandings = {};
    vorrundeGruppen.forEach(function(g) {
      groupStandings[g] = calcTable(g);
    });

    // ── 4. Hauptrunden-Gruppen bilden ────────────────────────
    // hauptrundeGroups[0] = Gruppe 1 (Erstplatzierte), etc.
    // Je Gruppe: [TeamA, TeamB, TeamC, TeamD] in Reihenfolge A→B→C→D
    var hauptrundeGroups = [[], [], [], [], []];
    vorrundeGruppen.forEach(function(g) {
      var standings = groupStandings[g];
      for (var pos = 0; pos < 5; pos++) {
        if (standings[pos]) {
          hauptrundeGroups[pos].push(standings[pos].id);
        }
      }
    });

    // Sicherstellen, dass jede Gruppe exakt 4 Teams hat
    for (var gi = 0; gi < 5; gi++) {
      if (hauptrundeGroups[gi].length !== 4) {
        return jsonError(
          'Hauptrunden-Gruppe ' + (gi + 1) +
          ' hat nicht genau 4 Teams (gefunden: ' + hauptrundeGroups[gi].length + ')'
        );
      }
    }

    // ── 5. Spielplan generieren ──────────────────────────────
    /**
     * Paarungen für eine 4er-Gruppe [T1,T2,T3,T4] über 3 Spieltage:
     *   Spieltag 1: T1 vs T2 + T3 vs T4
     *   Spieltag 2: T1 vs T3 + T2 vs T4
     *   Spieltag 3: T1 vs T4 + T2 vs T3
     *
     * fieldOffset: 0 → Felder 1+2, 2 → Felder 3+4
     */
    function getGames(groupNum, spieltag, fieldOffset) {
      var t = hauptrundeGroups[groupNum - 1]; // [T1, T2, T3, T4]
      var pairs;
      if (spieltag === 1) {
        pairs = [[t[0], t[1]], [t[2], t[3]]];
      } else if (spieltag === 2) {
        pairs = [[t[0], t[2]], [t[1], t[3]]];
      } else {
        pairs = [[t[0], t[3]], [t[1], t[2]]];
      }
      return [
        { group: groupNum, homeId: pairs[0][0], awayId: pairs[0][1], field: fieldOffset + 1 },
        { group: groupNum, homeId: pairs[1][0], awayId: pairs[1][1], field: fieldOffset + 2 }
      ];
    }

    // Optimaler Spielplan (8 Runden, Runden 11–18)
    var schedule = [
      { round: 11, games: getGames(1,1,0).concat(getGames(2,1,2)) },
      { round: 12, games: getGames(3,1,0).concat(getGames(4,1,2)) },
      { round: 13, games: getGames(5,1,0).concat(getGames(1,2,2)) },
      { round: 14, games: getGames(5,2,0).concat(getGames(2,2,2)) },
      { round: 15, games: getGames(5,3,0).concat(getGames(3,2,2)) },
      { round: 16, games: getGames(1,3,0).concat(getGames(4,2,2)) },
      { round: 17, games: getGames(2,3,0).concat(getGames(3,3,2)) },
      { round: 18, games: getGames(4,3,0) }  // nur 2 Felder
    ];

    // ── 6. matchesP2-Sheet befüllen ──────────────────────────
    var rows = [['group', 'round', 'field', 'homeId', 'awayId', 'scoreH', 'scoreA']];
    schedule.forEach(function(rd) {
      rd.games.forEach(function(g) {
        rows.push([g.group, rd.round, g.field, g.homeId, g.awayId, '', '']);
      });
    });

    p2Sheet.clearContents();
    p2Sheet.getRange(1, 1, rows.length, 7).setValues(rows);

    return jsonSuccess({
      message:    'Hauptrunde erfolgreich generiert',
      matchCount: rows.length - 1,
      groups: {
        'Gruppe 1 (Rot)':    hauptrundeGroups[0],
        'Gruppe 2 (Blau)':   hauptrundeGroups[1],
        'Gruppe 3 (Grün)':   hauptrundeGroups[2],
        'Gruppe 4 (Gelb)':   hauptrundeGroups[3],
        'Gruppe 5 (Orange)': hauptrundeGroups[4]
      }
    });

  } catch (err) {
    return jsonError('generateHauptrunde: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// HELPER UTILITIES
// ──────────────────────────────────────────────────────────────

/** Liest ein Sheet und gibt ein Array von Objekten zurück */
function readSheet(ss, name, expectedHeaders) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var result  = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Leerzeilen überspringen
    if (row.every(function(v) { return v === '' || v === null || v === undefined; })) continue;
    var obj = {};
    headers.forEach(function(h, idx) {
      var val = row[idx];
      obj[h] = (val === null || val === undefined) ? '' : val;
    });
    result.push(obj);
  }
  return result;
}

/** Liest das config-Sheet und gibt ein flaches Objekt zurück */
function readConfig(ss) {
  var sheet = ss.getSheetByName('config');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var config = {};
  // Zwei mögliche Formate:
  //   Format A: Header-Zeile (key) + Wert-Zeile (value)
  //   Format B: Zwei Spalten key | value pro Zeile
  if (data.length >= 2 && data[0].length > 1 && data[1].length > 1) {
    // Format A: erste Zeile = Keys, zweite Zeile = Werte
    var keys   = data[0];
    var values = data[1];
    keys.forEach(function(k, idx) {
      if (k) config[String(k).trim()] = values[idx] !== undefined ? values[idx] : '';
    });
  } else {
    // Format B: key-value-Paare pro Zeile
    data.forEach(function(row) {
      if (row[0]) config[String(row[0]).trim()] = row[1] !== undefined ? row[1] : '';
    });
  }
  return config;
}

function jsonSuccess(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'success', data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
