/**
 * מחסום פריסה · רץ אוטומטית לפני `npm run deploy` (predeploy).
 *
 * למה זה קיים: `.github/workflows/daily-content.yml` רץ כל בוקר ב-05:00 UTC,
 * עושה `git pull --rebase origin main`, בונה מהריפו ופורס. כלומר **הפרודקשן
 * נבנה מ-origin/main כל 24 שעות**. כל דבר שנפרס ידנית ולא נמצא ב-origin/main
 * נמחק מהאוויר בהרצה הבאה, בשקט.
 *
 * זה קרה בפועל (2026-07-19): סשן שלם של עבודה נפרס עם `wrangler pages deploy`
 * בלי קומיט, וההרצה היומית מחקה את הכל תוך יממה.
 *
 * לכן פריסה מותרת רק כשמתקיימים שלושת התנאים:
 *   1. על ענף main (הענף שממנו נבנה הפרודקשן)
 *   2. עץ עבודה נקי · אין שינויים לא-מקומיטים
 *   3. מסונכרן מול origin/main · אין מה לדחוף ואין מה למשוך
 *
 * קומיט מקומי שלא נדחף נחשב כישלון בכוונה · ההרצה היומית לא רואה אותו.
 */
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const die = (title, why, fix) => {
  console.error(`\n${RED}${BOLD}✗ הפריסה נחסמה · ${title}${OFF}\n`);
  console.error(`  ${why}\n`);
  console.error(`  ${BOLD}מה לעשות:${OFF}\n${fix.map((l) => `    ${l}`).join('\n')}\n`);
  console.error(`  ${DIM}למה: ההרצה היומית (05:00 UTC) בונה מ-origin/main ופורסת.`);
  console.error(`  כל מה שלא נמצא שם נמחק מהאוויר תוך 24 שעות.${OFF}\n`);
  process.exit(1);
};

// 1. ענף
let branch;
try { branch = sh('git rev-parse --abbrev-ref HEAD'); } catch {
  die('אין ריפו גיט', 'לא הצלחתי לקרוא את מצב הגיט בתיקייה הזו.', ['ודא שאתה מריץ מתוך תיקיית הריפו']);
}
if (branch !== 'main') {
  die(`אתה על ענף ${branch}`, 'הפרודקשן נבנה מ-main בלבד, אז פריסה מענף אחר תידרס בהרצה היומית.', [
    `${YELLOW}git checkout main${OFF}`,
    `${DIM}(או מזג את ${branch} ל-main ואז פרוס)${OFF}`,
  ]);
}

// 2. עץ נקי
const dirty = sh('git status --porcelain');
if (dirty) {
  const files = dirty.split('\n').slice(0, 12).map((l) => `${DIM}${l}${OFF}`);
  const more = dirty.split('\n').length > 12 ? [`${DIM}… ועוד${OFF}`] : [];
  die('יש שינויים לא-מקומיטים', 'הפריסה תעלה אותם, אבל הם לא ב-origin/main · ההרצה היומית תמחק אותם.', [
    ...files, ...more, '',
    `${YELLOW}git add -A && git commit -m "..." && git push${OFF}`,
  ]);
}

// 3. סנכרון מול origin/main
try { execSync('git fetch origin main --quiet', { stdio: 'ignore' }); } catch {
  console.warn(`${YELLOW}⚠ לא הצלחתי לעשות fetch · ממשיך עם המידע המקומי${OFF}`);
}
const ahead = Number(sh('git rev-list --count origin/main..HEAD'));
const behind = Number(sh('git rev-list --count HEAD..origin/main'));

if (ahead > 0) {
  die(`יש ${ahead} קומיטים שלא נדחפו`, 'קומיט מקומי לא מספיק · ההרצה היומית בונה מ-origin/main ולא תראה אותו.', [
    `${YELLOW}git push origin main${OFF}`,
  ]);
}
if (behind > 0) {
  die(`אתה מפגר ב-${behind} קומיטים מ-origin`, 'פריסה עכשיו תעלה בילד ישן ותמחק עבודה של אחרים (למשל מאמרי מכונת התוכן).', [
    `${YELLOW}git pull --rebase origin main${OFF}`,
    `${DIM}ואז בנה ופרוס מחדש${OFF}`,
  ]);
}

console.log(`${GREEN}✓ מחסום הפריסה עבר${OFF} ${DIM}· main · עץ נקי · מסונכרן עם origin/main (${sh('git rev-parse --short HEAD')})${OFF}`);
