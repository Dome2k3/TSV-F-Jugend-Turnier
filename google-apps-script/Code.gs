/**
 * ============================================================
 *  F-Jugend Sommer-Cup – Google Apps Script Backend
 *  Kopiere diesen Code vollständig in den Google Apps Script
 *  Editor (script.google.com) und deploye ihn als Web App.
 * ============================================================
 *
 *  Sheet-Struktur:
 *    Config    – key | value (z.B. tournamentName, tournamentDate, logoClub, logoSponsor1, logoSponsor2)
 *    Teams     – id | name | gruppe
 *    MatchesP1 – group | round | field | homeId | awayId | scoreH | scoreA
 *    MatchesP2 – group | round | field | homeId | awayId | scoreH | scoreA
 *    Helfer    – schicht | aufgabe | name | kind | email | timestamp
 *    Aufgaben  – item | wer
 */

// ──────────────────────────────────────────────────────────────
// HTTP ENTRY POINTS
// ──────────────────────────────────────────────────────────────

function doGet(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);

  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

    if (action === 'get_tournament_data') {
      return getTournamentData();
    }

    if (action === 'debug') {
      return getDebugData();
    }

    // Default: Helfer + Aufgaben zurückgeben (Abwärtskompatibilität)
    return getDefaultHelferAufgaben();

  } catch (err) {
    return jsonError('doGet: ' + err.toString());
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);

  try {
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

  } catch (err) {
    return jsonError('doPost: ' + err.toString());
  } finally {
    lock.releaseLock();
  }
}

// ──────────────────────────────────────────────────────────────
// DEBUG
// ──────────────────────────────────────────────────────────────

function getDebugData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var debugResult = {
    sheets: [],
    teamsRaw: [],
    matchesP1Raw: []
  };

  var allSheets = ss.getSheets();
  allSheets.forEach(function(s) {
    debugResult.sheets.push(s.getName());
  });

  var teamsSheet = ss.getSheetByName('Teams');
  if (teamsSheet) {
    var tv = teamsSheet.getDataRange().getValues();
    for (var i = 0; i < Math.min(tv.length, 5); i++) {
      debugResult.teamsRaw.push({
        row: i,
        col0: String(tv[i][0]),
        col1: String(tv[i][1]),
        col2: String(tv[i][2]),
        col2type: typeof tv[i][2]
      });
    }
  } else {
    debugResult.teamsRaw = ["Sheet 'Teams' NOT FOUND"];
  }

  var mp1Sheet = ss.getSheetByName('MatchesP1');
  if (mp1Sheet) {
    var mv = mp1Sheet.getDataRange().getValues();
    for (var j = 0; j < Math.min(mv.length, 5); j++) {
      debugResult.matchesP1Raw.push({
        row: j,
        col0: String(mv[j][0]),
        col1: String(mv[j][1]),
        col2: String(mv[j][2]),
        col3: String(mv[j][3]),
        col4: String(mv[j][4])
      });
    }
  } else {
    debugResult.matchesP1Raw = ["Sheet 'MatchesP1' NOT FOUND"];
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'debug', data: debugResult }, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ──────────────────────────────────────────────────────────────
// DEFAULT GET: Helfer + Aufgaben (Abwärtskompatibilität)
// ──────────────────────────────────────────────────────────────

function getDefaultHelferAufgaben() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var helferData = [];
  // ✅ FIX: 'Teilnehmer' → 'Helfer' (umbenanntes Sheet)
  var sheetHelfer = ss.getSheetByName('Helfer');
  if (sheetHelfer) {
    var rowsHelfer = sheetHelfer.getDataRange().getValues();
    // Helfer-Sheet: schicht | aufgabe | name | kind | email | timestamp
    //               [0]       [1]       [2]    [3]    [4]     [5]
    for (var i = 1; i < rowsHelfer.length; i++) {
      if (rowsHelfer[i][2]) {  // ✅ FIX: Spalte [2] = name (war [1])
        helferData.push({
          name:    rowsHelfer[i][2],
          kind:    rowsHelfer[i][3],
          schicht: rowsHelfer[i][0],  // ✅ FIX: schicht ist Spalte [0]
          aufgabe: rowsHelfer[i][1]   // ✅ FIX: aufgabe ist Spalte [1]
        });
      }
    }
  }

  var aufgabenData = [];
  var sheetAufgaben = ss.getSheetByName('Aufgaben');
  if (sheetAufgaben) {
    var rowsAufgaben = sheetAufgaben.getDataRange().getValues();
    for (var j = 1; j < rowsAufgaben.length; j++) {
      if (rowsAufgaben[j][0]) {
        aufgabenData.push({
          item: rowsAufgaben[j][0],
          wer:  rowsAufgaben[j][1] || ''
        });
      }
    }
  }

  return jsonSuccess({ helfer: helferData, aufgaben: aufgabenData });
}

// ──────────────────────────────────────────────────────────────
// GET TOURNAMENT DATA
// ──────────────────────────────────────────────────────────────

function getTournamentData() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var config    = readConfig(ss);
    var teams     = readSheet(ss, 'Teams',     ['id','name','gruppe']);
    var matchesP1 = readSheet(ss, 'MatchesP1', ['group','round','field','homeId','awayId','scoreH','scoreA']);
    var matchesP2 = readSheet(ss, 'MatchesP2', ['group','round','field','homeId','awayId','scoreH','scoreA']);
    var helfer    = readSheet(ss, 'Helfer',    ['schicht','aufgabe','name','kind','email','timestamp']);
    var aufgaben  = readSheet(ss, 'Aufgaben',  ['item','wer']);

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
    var phase  = String(params.phase  || '').trim();   // 'p1' or 'p2'
    var homeId = String(params.homeId || '').trim();
    var awayId = String(params.awayId || '').trim();
    var group  = String(params.group  || '').trim();
    var round  = String(params.round  || '').trim();
    var field  = String(params.field  || '').trim();
    var scoreH = params.scoreH;
    var scoreA = params.scoreA;

    if (!homeId || !awayId) {
      return jsonError('Fehlende Parameter (homeId, awayId)');
    }
    if (scoreH === '' || scoreH === undefined || scoreA === '' || scoreA === undefined) {
      return jsonError('Fehlende Ergebnisse');
    }

    var sheetName = (phase === 'p2') ? 'MatchesP2' : 'MatchesP1';
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return jsonError('Sheet nicht gefunden: ' + sheetName);

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var iGroup  = headers.indexOf('group');
    var iRound  = headers.indexOf('round');
    var iField  = headers.indexOf('field');
    var iHomeId = headers.indexOf('homeId');
    var iAwayId = headers.indexOf('awayId');
    var iScoreH = headers.indexOf('scoreH');
    var iScoreA = headers.indexOf('scoreA');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];

      // Pflicht: homeId + awayId müssen übereinstimmen
      if (String(row[iHomeId]).trim() !== homeId) continue;
      if (String(row[iAwayId]).trim() !== awayId) continue;

      // Optional: group, round, field – nur prüfen wenn übergeben
      if (group !== '' && String(row[iGroup]).trim() !== group) continue;
      if (round !== '' && String(row[iRound]).trim() !== round) continue;
      if (field !== '' && String(row[iField]).trim() !== field) continue;

      sheet.getRange(i + 1, iScoreH + 1).setValue(Number(scoreH));
      sheet.getRange(i + 1, iScoreA + 1).setValue(Number(scoreA));
      return jsonSuccess({ updated: true });
    }

    return jsonError('Spiel nicht gefunden (homeId=' + homeId + ', awayId=' + awayId + ')');
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
    var sheet  = ss.getSheetByName('Helfer');
    if (!sheet) return jsonError('Sheet "Helfer" nicht gefunden');

    var schicht   = params.schicht  || '';
    var aufgabe   = params.aufgabe  || '';
    var name      = params.name     || '';
    var kind      = params.kind     || '';
    var email     = params.email    || '';
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
    var taskName   = (params.taskName   || '').trim();
    var personName = (params.personName || '').trim();
    if (!taskName || !personName) return jsonError('taskName und personName erforderlich');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Aufgaben');
    if (!sheet) return jsonError('Sheet "Aufgaben" nicht gefunden');

    var data    = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonError('Sheet "Aufgaben" ist leer');

    var headers = data[0].map(h => String(h || '').trim());

    // ✅ akzeptiere beide Header-Namen
    var iItem = headers.indexOf('item');
    if (iItem < 0) iItem = headers.indexOf('Aufgabe');

    var iWer = headers.indexOf('wer');
    if (iWer < 0) iWer = headers.indexOf('Wer');

    if (iItem < 0) return jsonError('Aufgaben-Sheet: Spalte "Aufgabe" (oder "item") nicht gefunden');
    if (iWer < 0)  return jsonError('Aufgaben-Sheet: Spalte "Wer" (oder "wer") nicht gefunden');

    for (var i = 1; i < data.length; i++) {
      var cellTask = String(data[i][iItem] || '').trim();
      if (!cellTask) continue;

      // optional: Überschriftszeilen ignorieren
      if (cellTask.indexOf('---') === 0) continue;

      if (cellTask === taskName) {
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
    var taskName = (params.taskName || '').trim();
    if (!taskName) return jsonError('taskName erforderlich');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Aufgaben');
    if (!sheet) return jsonError('Sheet "Aufgaben" nicht gefunden');

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonError('Sheet "Aufgaben" ist leer');

    var headers = data[0].map(h => String(h || '').trim());

    // Aufgabe/item
    var iItem = headers.indexOf('item');
    if (iItem < 0) iItem = headers.indexOf('Aufgabe');

    // Wer/wer
    var iWer = headers.indexOf('wer');
    if (iWer < 0) iWer = headers.indexOf('Wer');

    // Davor/davor
    var iDavor = headers.indexOf('davor');
    if (iDavor < 0) iDavor = headers.indexOf('Davor');

    if (iItem < 0)  return jsonError('Aufgaben-Sheet: Spalte "Aufgabe" (oder "item") nicht gefunden');
    if (iWer < 0)   return jsonError('Aufgaben-Sheet: Spalte "Wer" (oder "wer") nicht gefunden');
    if (iDavor < 0) return jsonError('Aufgaben-Sheet: Spalte "Davor" (oder "davor") nicht gefunden');

    for (var i = 1; i < data.length; i++) {
      var cellTask = String(data[i][iItem] || '').trim();
      if (!cellTask) continue;
      if (cellTask.indexOf('---') === 0) continue;

      if (cellTask === taskName) {
        var currentWer = String(data[i][iWer] || '').trim();

        // Wenn sowieso keiner eingetragen ist, nur "Wer" leeren (ist eh leer) und fertig.
        if (!currentWer) {
          sheet.getRange(i + 1, iWer + 1).setValue('');
          return jsonSuccess({ unclaimed: true, previous: '' });
        }

        // ✅ Historie: bisherigen Wer-Eintrag nach Davor (anhängen)
        var ts = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm");
        var historyEntry = currentWer + " (" + ts + ")";

        var existingHistory = String(data[i][iDavor] || '').trim();
        var newHistory = existingHistory ? (existingHistory + "\n" + historyEntry) : historyEntry;

        sheet.getRange(i + 1, iDavor + 1).setValue(newHistory);

        // ✅ jetzt austragen
        sheet.getRange(i + 1, iWer + 1).setValue('');

        return jsonSuccess({ unclaimed: true, previous: currentWer });
      }
    }

    return jsonError('Aufgabe nicht gefunden: ' + taskName);
  } catch (err) {
    return jsonError('unclaimTask: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// GENERATE HAUPTRUNDE
// ──────────────────────────────────────────────────────────────

/**
 * Berechnet aus den Vorrunden-Ergebnissen (MatchesP1) die Tabellen
 * der vier Vorrunden-Gruppen (A–D), bildet daraus die fünf
 * Hauptrunden-Leveling-Gruppen (1–5) und schreibt den fertigen
 * Spielplan in das MatchesP2-Sheet.
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
    var p1Sheet    = ss.getSheetByName('MatchesP1');
    var p2Sheet    = ss.getSheetByName('MatchesP2');
    var teamsSheet = ss.getSheetByName('Teams');

    if (!p1Sheet)    return jsonError('Sheet "MatchesP1" nicht gefunden');
    if (!p2Sheet)    return jsonError('Sheet "MatchesP2" nicht gefunden');
    if (!teamsSheet) return jsonError('Sheet "Teams" nicht gefunden');

    // ── 1. Teams einlesen ────────────────────────────────────
    var teamsData = teamsSheet.getDataRange().getValues();
    var tHeaders = teamsData[0];
    var tId      = tHeaders.indexOf('id');
    var tName    = tHeaders.indexOf('name');
    var tGruppe  = tHeaders.indexOf('gruppe');
    if (tId < 0 || tName < 0 || tGruppe < 0) {
      return jsonError('Teams-Sheet: Spalten "id", "name", "gruppe" erwartet');
    }

    var teamMap = {};
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
      return jsonError('MatchesP1-Sheet: Spalten "group","homeId","awayId","scoreH","scoreA" erwartet');
    }

    var matches = [];
    var missingScores = 0;
    for (var i = 1; i < p1Data.length; i++) {
      var row = p1Data[i];
      if (!row[c.group] || !row[c.homeId]) continue;
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

    function calcTable(groupLetter) {
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

      var rows = Object.values(table);
      rows.sort(function(a, b) {
        if (b.points !== a.points) return b.points - a.points;
        var dA = a.goalsFor - a.goalsAgainst;
        var dB = b.goalsFor - b.goalsAgainst;
        if (dB !== dA) return dB - dA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name, 'de');
      });

      return rows;
    }

    var groupStandings = {};
    vorrundeGruppen.forEach(function(g) {
      groupStandings[g] = calcTable(g);
    });

    // ── 4. Hauptrunden-Gruppen bilden ────────────────────────
    var hauptrundeGroups = [[], [], [], [], []];
    vorrundeGruppen.forEach(function(g) {
      var standings = groupStandings[g];
      for (var pos = 0; pos < 5; pos++) {
        if (standings[pos]) {
          hauptrundeGroups[pos].push(standings[pos].id);
        }
      }
    });

    for (var gi = 0; gi < 5; gi++) {
      if (hauptrundeGroups[gi].length !== 4) {
        return jsonError(
          'Hauptrunden-Gruppe ' + (gi + 1) +
          ' hat nicht genau 4 Teams (gefunden: ' + hauptrundeGroups[gi].length + ')'
        );
      }
    }

    // ── 5. Spielplan generieren ──────────────────────────────
    function getGames(groupNum, spieltag, fieldOffset) {
      var t = hauptrundeGroups[groupNum - 1];
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

    var schedule = [
      { round: 11, games: getGames(1,1,0).concat(getGames(2,1,2)) },
      { round: 12, games: getGames(3,1,0).concat(getGames(4,1,2)) },
      { round: 13, games: getGames(5,1,0).concat(getGames(1,2,2)) },
      { round: 14, games: getGames(5,2,0).concat(getGames(2,2,2)) },
      { round: 15, games: getGames(5,3,0).concat(getGames(3,2,2)) },
      { round: 16, games: getGames(1,3,0).concat(getGames(4,2,2)) },
      { round: 17, games: getGames(2,3,0).concat(getGames(3,3,2)) },
      { round: 18, games: getGames(4,3,0) }
    ];

    // ── 6. MatchesP2-Sheet befüllen ──────────────────────────
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

/** Liest das Config-Sheet und gibt ein flaches Objekt zurück */
function readConfig(ss) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var config = {};
  // Zwei mögliche Formate:
  //   Format A: Header-Zeile (key) + Wert-Zeile (value)  →  tournamentName | tournamentDate | logoClub | ...
  //   Format B: Zwei Spalten key | value pro Zeile
  if (data.length >= 2 && data[0].length > 2) {
    // Format A: erste Zeile = Keys, zweite Zeile = Werte
    var keys   = data[0];
    var values = data[1];
    keys.forEach(function(k, idx) {
      if (k) config[String(k).trim()] = values[idx] !== undefined ? values[idx] : '';
    });
  } else {
    // Format B: key-value-Paare pro Zeile
    for (var r = 1; r < data.length; r++) {
      var key = data[r][0];
      var val = data[r][1];
      if (key) config[String(key).trim()] = val !== undefined ? val : '';
    }
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
