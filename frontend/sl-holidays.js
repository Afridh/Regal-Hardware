/* Sri Lanka's public holidays and Full Moon Poya days: the days the shop is closed unless the Super Admin
   opens it. Shared by the till (index.html) and the shift clock (shift.html); the Super Admin's own
   changes are kept in the books (S.shift.holidays for extra closed days, S.shift.openDays for these days
   opened), so this list is only the starting point.

   2026 is the gazetted list (govt.sl, cross-checked with publicholidays.lk and induwara.lk).
   2027 is PROVISIONAL until its gazette is out: the sources differ by a day on Madin Poya (21 or 22 March)
   and on Vesak (20–21 or 19–20 May), and the Islamic festival days move with the moon sighting. Check
   them against the gazette and correct any day in the Attendance sheet. Add each new year here. */
window.SL_HOLIDAYS = {
  // 2026
  '2026-01-03': 'Duruthu Full Moon Poya Day',
  '2026-01-15': 'Tamil Thai Pongal Day',
  '2026-02-01': 'Navam Full Moon Poya Day',
  '2026-02-04': 'National Day',
  '2026-02-15': 'Mahasivarathri Day',
  '2026-03-02': 'Madin Full Moon Poya Day',
  '2026-03-21': 'Id-Ul-Fitr (Ramazan Festival Day)',
  '2026-04-01': 'Bak Full Moon Poya Day',
  '2026-04-03': 'Good Friday',
  '2026-04-13': 'Day prior to Sinhala and Tamil New Year Day',
  '2026-04-14': 'Sinhala and Tamil New Year Day',
  '2026-05-01': 'Vesak Full Moon Poya Day · May Day',
  '2026-05-02': 'Day following Vesak Full Moon Poya Day',
  '2026-05-28': 'Id-Ul-Alha (Hadji Festival Day)',
  '2026-05-30': 'Adhi Poson Full Moon Poya Day',
  '2026-06-29': 'Poson Full Moon Poya Day',
  '2026-07-29': 'Esala Full Moon Poya Day',
  '2026-08-26': 'Milad-Un-Nabi (Holy Prophet\'s Birthday)',
  '2026-08-27': 'Nikini Full Moon Poya Day',
  '2026-09-26': 'Binara Full Moon Poya Day',
  '2026-10-25': 'Vap Full Moon Poya Day',
  '2026-11-08': 'Deepavali Festival Day',
  '2026-11-24': 'Ill Full Moon Poya Day',
  '2026-12-23': 'Unduvap Full Moon Poya Day',
  '2026-12-25': 'Christmas Day',
  // 2027 — provisional (see above)
  '2027-01-15': 'Tamil Thai Pongal Day',
  '2027-01-22': 'Duruthu Full Moon Poya Day',
  '2027-02-04': 'National Day',
  '2027-02-20': 'Navam Full Moon Poya Day',
  '2027-03-06': 'Mahasivarathri Day',
  '2027-03-10': 'Id-Ul-Fitr (Ramazan Festival Day)',
  '2027-03-21': 'Madin Full Moon Poya Day',
  '2027-03-26': 'Good Friday',
  '2027-04-13': 'Day prior to Sinhala and Tamil New Year Day',
  '2027-04-14': 'Sinhala and Tamil New Year Day',
  '2027-04-20': 'Bak Full Moon Poya Day',
  '2027-05-01': 'May Day',
  '2027-05-17': 'Id-Ul-Alha (Hadji Festival Day)',
  '2027-05-20': 'Vesak Full Moon Poya Day',
  '2027-05-21': 'Day following Vesak Full Moon Poya Day',
  '2027-06-18': 'Poson Full Moon Poya Day',
  '2027-07-18': 'Esala Full Moon Poya Day',
  '2027-08-15': 'Milad-Un-Nabi (Holy Prophet\'s Birthday)',
  '2027-08-16': 'Nikini Full Moon Poya Day',
  '2027-09-15': 'Binara Full Moon Poya Day',
  '2027-10-15': 'Vap Full Moon Poya Day',
  '2027-10-28': 'Deepavali Festival Day',
  '2027-11-13': 'Ill Full Moon Poya Day',
  '2027-12-13': 'Unduvap Full Moon Poya Day',
  '2027-12-25': 'Christmas Day'
};

/* The one rule for "is the shop closed that day", used by both pages. sh is the books' S.shift. */
window.slHoliday = function (sh, ds) {
  sh = sh || {};
  if ((sh.openDays || []).includes(ds)) return null;                         // the Super Admin opened it
  const own = (sh.holidays || []).find(h => h && h.date === ds);
  if (own) return own.name || 'Shop holiday';                                 // a day the shop added
  return window.SL_HOLIDAYS[ds] || null;
};
