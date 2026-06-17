import { parseRTF, extractVerseStructureFromRTF } from '../src/services/migration/rtfParser';
import { execSync } from 'child_process';
import * as fs from 'fs';

const CWD = '/Users/danielabakah/code/JS/selah';

// Get ALL songs
const songsRaw = execSync(
  `sqlite3 SongWords.db "ATTACH 'Songs.db' AS songs; SELECT w.song_id, s.title, LENGTH(w.words) FROM word w JOIN songs.song s ON s.rowid = w.song_id WHERE LENGTH(w.words) > 0 ORDER BY w.song_id"`,
  { encoding: 'utf-8', cwd: CWD, maxBuffer: 10*1024*1024 }
);

const songs = songsRaw.trim().split('\n').map(line => {
  const parts = line.split('|');
  return { song_id: parseInt(parts[0]), title: parts[1], len: parseInt(parts[2]) };
});

console.log(`Total songs: ${songs.length}\n`);

let issuesFound = 0;
const issueDetails: any[] = [];

for (const song of songs) {
  try {
    execSync(
      `sqlite3 SongWords.db "SELECT writefile('/tmp/rtf_${song.song_id}.txt', words) FROM word WHERE song_id = ${song.song_id}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    
    const rtf = fs.readFileSync(`/tmp/rtf_${song.song_id}.txt`, 'utf-8');
    const plainText = parseRTF(rtf);
    const verses = extractVerseStructureFromRTF(rtf);
    
    const issues: string[] = [];
    
    // RTF residue
    const rtfResidue = plainText.match(/\\[a-z]+\d*/gi);
    if (rtfResidue) issues.push(`RTF residue: ${[...new Set(rtfResidue)].slice(0, 5).join(', ')}`);
    
    // Empty verses
    const emptyVerses = verses.filter(v => !v.content.trim());
    if (emptyVerses.length > 0) issues.push(`${emptyVerses.length} empty verse(s)`);
    
    // Verse labels in content but not extracted  
    if (verses.length === 1 && !verses[0].label) {
      const labelInContent = plainText.match(/^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending)\s*\d*\s*$/im);
      if (labelInContent) issues.push('Labels in content, not extracted as verses');
    }
    
    // Garbage chars
    const garbage = plainText.match(/[\uFFFD\u0000-\u0008\u000B\u000E-\u001F]/g);
    if (garbage) issues.push(`${garbage.length} garbage chars`);
    
    // Very short output
    if (plainText.length < 10 && rtf.length > 100) issues.push(`Suspiciously short: ${plainText.length} from ${rtf.length}`);
    
    // No line breaks
    if (plainText.length > 50 && !plainText.includes('\n')) issues.push('No line breaks');
    
    // Empty output
    if (!plainText.trim()) issues.push('EMPTY OUTPUT');

    // "Slide N" labels not parsed
    const slideLabels = plainText.match(/^Slide \d+$/gim);
    if (slideLabels && slideLabels.length > 0) issues.push(`${slideLabels.length} "Slide N" labels in text`);

    // "repeat" or "REPEAT" on its own line
    const repeatLabels = plainText.match(/^repeat$/gim);
    if (repeatLabels && repeatLabels.length > 0) issues.push(`${repeatLabels.length} "repeat" labels`);

    if (issues.length > 0) {
      issuesFound++;
      issueDetails.push({ song_id: song.song_id, title: song.title, issues, plainText: plainText.substring(0, 300), verseCount: verses.length });
    }
  } catch (e) {
    issuesFound++;
    issueDetails.push({ song_id: song.song_id, title: song.title, issues: [`EXCEPTION: ${e}`], plainText: '', verseCount: 0 });
  }
}

console.log(`Songs with issues: ${issuesFound} / ${songs.length}\n`);

// Group by issue type
const issueCounts: Record<string, number> = {};
for (const d of issueDetails) {
  for (const issue of d.issues) {
    const key = issue.replace(/\d+/g, 'N');
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  }
}

console.log("=== ISSUE SUMMARY ===");
for (const [key, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}: ${count}`);
}

console.log("\n=== SAMPLES OF EACH ISSUE TYPE ===");
const seen = new Set<string>();
for (const d of issueDetails) {
  for (const issue of d.issues) {
    const key = issue.replace(/\d+/g, 'N');
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`\n--- ${key} ---`);
      console.log(`  Song #${d.song_id} "${d.title}":`);
      console.log(`  Issues: ${d.issues.join('; ')}`);
      console.log(`  Verses: ${d.verseCount}`);
      console.log(`  Text: ${JSON.stringify(d.plainText.substring(0, 250))}`);
    }
  }
}
