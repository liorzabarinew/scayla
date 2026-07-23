# פול רעיונות · מנוע התוכן של Scayla

מסמך חי · פול משותף של רעיונות מדורגים (impact ÷ effort). נוצר 2026-07-23 משתי
חקירות מבוססות-קוד/תוכן-חי (לא רעיונות גנריים). כל פריט עם ראיה (file:line או בדיקה חיה).

**מצב בסיס:** 63 מאמרים · 4 אשכולות מאוזנים (16/16/16/15) · ~1,269 מילים/מאמר ·
GEO חזק (direct-answer 63/63, FAQ 63/63, sources 61/63, schema מלא Article+FAQPage+BreadcrumbList+Person).
החולשות מרוכזות ב: **אימות-עובדות בכשל, refresh לא-מאומת, קישור למחוזי-כסף, יתומים, אורך meta, כוונת-רכישה.**

סטטוס: `[ ]` פתוח · `[~]` בעבודה · `[x]` בוצע.

---

## 🛡️ חיסון המנוע (איכות + אמינות)

### Top-priority (impact גבוה, effort נמוך)
- `[ ]` **E1 · qaSourceGrounding רץ עם `thinkingBudget:0` (מסונוור)** — ה-lens היחיד שבודק כל מספר מול טקסט-המקור בפועל רץ בלי thinking (`machine-vertex.mjs:622`). זו בדיוק ההגנה מפני שגיאת-מספר כמו Akamai 7%→1%, והיא הקריאה הכי-חלשה בצינור. **תיקון:** תן לו budget אמיתי (~1024, כמו refresh:233). **impact High · effort Low.**
- `[ ]` **E2 · הכותב fail-OPEN כשכל ה-QA נכשל** — אם כל 5 ה-lenses מחזירים null (תקלת Vertex/מכסה), `issues=[]` ו-`qaNote='clean'` → מאמר לא-מאומת מתפרסם (`machine-vertex.mjs:795-825`). ה-fixer כבר מגן על זה (`fixer.mjs:74`), הכותב לא. **תיקון:** אם כל ה-lenses null → shelve. **impact High · effort Low.**
- `[ ]` **E3 · כשל-פרסינג של QA נספר כ"clean"** — `qaGeminiClaims`/`qaCrossModel`/`qaSourceGrounding` מחזירים pass על JSON שבור (:595/:604/:626) → critic מקולקל = clean מזויף. **תיקון:** `_parseFailed` → issue רך "לאמת ידנית", לא pass. **impact Med-High · effort Low.**
- `[ ]` **E4 · מספר-שגוי לעולם לא "hard" → תמיד ship-with-note** — `HARD_ISSUE_RE` (:79) לא כולל טענה-מספרית לא-מאומתת, אז מספר שורד 3 סבבים ומתפרסם עם הערה (:856-857). **תיקון:** מחלקת "מספר-לא-נתמך ששרד את הסבב האגרסיבי" → shelve. **impact Med-High · effort Low.**

### Medium (שווה effort)
- `[ ]` **E5 · refresh.mjs מחליף מספרים בלי אימות (correct→wrong)** — שורש הבאג שראינו חי: מקבל `{find,replace,source}`, מחיל אם `find` בגוף ו-`source` רק תואם regex `^https?://` (:246-248). ה-source **לא נמשך**, ה-replace לא נבדק, ו**אף lens לא רץ על המאמר המרוענן**. **תיקון:** משוך את ה-source, הפל שינוי שהמספר החדש לא מופיע בו, אל תחליש מספר שכבר יש לו entry ב-`sources:`. **impact High · effort Med.**
- `[ ]` **E6 · אין נעילה בין-ריצות** — `markDone` רק בסוף (:892); שתי ריצות חופפות בוחרות אותו topic → מאמר כפול (slug `-2`). **תיקון:** רזרבציה אופטימית ל-`topics-done` לפני הכתיבה, או lockfile. **impact Med · effort Med.**
- `[ ]` **E7 · sanitizeSlug שומר Latin גדול; gen-llms מנמיך → אי-התאמה** — קובץ `GEO-מול-SEO.md` נכתב mixed-case, אבל ה-route ו-llms.txt lowercase (`machine-vertex.mjs:384` מול `gen-llms.mjs:31`). קישור-כרטיס באתר (raw case) ו-llms עלולים לא-להסכים → 404. **תיקון:** הנמך Latin ב-sanitizeSlug בזמן-כתיבה כדי שהכל יסכים. **impact Med · effort Low.**
- `[ ]` **E8 · validateLinks מכסה רק /magazine/** — קישורי product/collection/external בגוף לא מאומתים (:499-503). כרגע latent (הפרומפט לא מבקש אותם), אבל מסוכן כשנפעיל קישור-למוצרים. **תיקון:** allowlist של routes תקינים, סמן external ל-fixer. **impact Low-Med · effort Low.**

**נבנה טוב, אל תיגע:** lintArticle (attribution/truncation/schema, :666-723, מכוסה ב-unit test), validateLinks fail-closed ל-/magazine, fmParses fail-closed, empty-brief retry (:766), idea-engine dedup (:216).

---

## 📝 תוכן ו-SEO/GEO (צמיחה)

### Top-priority
- `[ ]` **C1 · לאפשר קישור למחוזי-כסף (/features,/pricing,/scan)** — 0 קישורים כאלה ב-63 המאמרים; ה-sanitizer מוחק אותם (`machine-vertex.mjs:501-502`). דליפת-המרה טהורה. **תיקון:** allowlist + שורת-פרומפט ל-CTA קונטקסטואלי אחד/מאמר. **auto + backfill · impact High · effort Low.**
- `[ ]` **C2 · אורך meta description חורג בכל 63** — 197-288 תווים (גבול SERP ~155). 8+ כותרות 105-121 תווים. **תיקון:** אילוץ פרומפט (desc≤155, title≤~60) + guard שמפיל build על חריגה + backfill. **auto + backfill · impact Med-High · effort Low.**
- `[ ]` **C3 · 33/63 מאמרים יתומים (52% בלי קישור נכנס)** — reciprocity לא מובטח (:242). **תיקון:** pass שמזריק קישור מיתום ותיק באותו אשכול אל המאמר החדש + backfill. **auto + backfill · impact High · effort Med.**
- `[ ]` **C4 · כיסוי מסחרי דק — 74% אינפורמטיבי** — topics.json: 89 info / 24 commercial / 7 transactional. הקונה מחפש bottom-funnel ("Scayla מחיר", "חלופה ל-X", השוואות). **תיקון:** שקלל ב-idea-engine יותר commercial/comparison/alternative. **auto · impact High · effort Med.**

### Medium
- `[ ]` **C5 · עמודי-hub של אשכול דקים** — שורת-intro אחת + card grid, בלי pillar prose (`cluster/[cluster].astro:90`). **תיקון:** הרחב כל hub ל-150-300 מילות pillar + links ל-cornerstones. **one-time (4 עמודים) · impact Med · effort Med.**
- `[ ]` **C6 · אין הגדרת cornerstone/pillar** — related-links רק "same cluster+newest" (:41-50), בלי עמוד-עוגן לאשכול. **תיקון:** frontmatter `pillar:true` (1/אשכול), קשר supporting→pillar. משלים C3/C5. **auto + backfill · impact Med · effort Med.**
- `[ ]` **C7 · sources לא מוצגים בגוף** — 61/63 יש sources, נפלט כ-schema citation (:78) אבל אין בלוק "מקורות" בתבנית. AI ואנשים מתגמלים מקורות גלויים. **תיקון:** render בלוק "מקורות" מ-`post.data.sources`. **one-time (כל 63) · impact Med · effort Low.**
- `[ ]` **C8 · schema HowTo/SoftwareApplication חסר** — כיסוי כרגע Article/FAQPage/Breadcrumb/Person. 15 מדריכי-שלבים ראויים ל-HowTo; /pricing ל-SoftwareApplication+Offer. **תיקון:** זהה `## שלב`→HowTo; pricing→SoftwareApplication. **auto + one-time · impact Med · effort Med.**
- `[ ]` **C9 · (נמוך) freshness — guard לשנה/נתונים** — refresh תקין (נוגע רק ב-updatedDate), אבל ודא שהוא באמת מחליף "2025"→נוכחי בגוף, לא רק bump תאריך. **monitor · impact Low · effort Low.**

---

## 🏁 5 ראשונים לביצוע (חוצה-תחומים, impact÷effort)
1. **E1** — thinkingBudget:0→1024 על מאמת-המספרים (שורה אחת, מחזיר את ההגנה שנפלה בבאג ה-7%).
2. **C1** — פתיחת קישור למחוזי-כסף (דליפת-המרה, ~שעה, משפיע על הכל).
3. **C2** — guard אורך-meta (כל snippet ב-SERP כרגע נחתך).
4. **E2+E3** — סגירת ה-fail-open של הכותב (מאמר לא-מאומת לא יתפרסם בתקלת Vertex).
5. **E5** — refresh מאומת (שורש הבאג correct→wrong שראינו חי).
