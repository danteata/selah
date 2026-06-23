import { parseRTF, extractVerseStructureFromRTF } from '../src/services/migration/rtfParser';
import { execSync } from 'child_process';
import * as fs from 'fs';

const CWD = '/Users/danielabakah/code/JS/selah';

const songsRaw = execSync(
  `sqlite3 SongWords.db "ATTACH 'Songs.db' AS songs; SELECT w.song_id, s.title, LENGTH(w.words) FROM word w JOIN songs.song s ON s.rowid = w.song_id WHERE LENGTH(w.words) > 0 ORDER BY w.song_id LIMIT 30"`,
  { encoding: 'utf-8', cwd: CWD }
);

const songs = songsRaw.trim().split('\n').map(line => {
  const [id, title, len] = line.split('|');
  return { song_id: parseInt(id), title, len: parseInt(len) };
});

console.log("=== PARSING TEST (first 30 songs) ===\n");

for (const song of songs) {
  execSync(
    `sqlite3 SongWords.db "SELECT writefile('/tmp/rtf_${song.song_id}.txt', words) FROM word WHERE song_id = ${song.song_id}"`,
    { encoding: 'utf-8', cwd: CWD }
  );
  
  const rtf = fs.readFileSync(`/tmp/rtf_${song.song_id}.txt`, 'utf-8');
  const plainText = parseRTF(rtf);
  const verses = extractVerseStructureFromRTF(rtf);
  
  const issues: string[] = [];
  
  const rtfResidue = plainText.match(/\\[a-z]+\d*\s?/gi);
  if (rtfResidue) issues.push(`RTF residue: ${rtfResidue.slice(0, 5).join(', ')}`);
  
  const emptyVerses = verses.filter(v => !v.content.trim());
  if (emptyVerses.length > 0) issues.push(`${emptyVerses.length} empty verse(s)`);
  
  if (verses.length === 1 && !verses[0].label) {
    const labelInContent = plainText.match(/^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending)\s*\d*\s*$/im);
    if (labelInContent) issues.push('Verse labels in content but not extracted');
  }
  
  const garbage = plainText.match(/[\uFFFD\u0000-\u0008\u000B\u000E-\u001F]/g);
  if (garbage) issues.push(`Garbage chars: ${garbage.length}`);
  
  if (plainText.length < 10 && rtf.length > 100) issues.push(`Very short: ${plainText.length} from ${rtf.length}`);
  
  if (plainText.length > 50 && !plainText.includes('\n')) issues.push('No line breaks');
  
  if (!plainText.trim()) issues.push('EMPTY OUTPUT');

  const status = issues.length > 0 ? 'ISSUES' : 'OK';
  console.log(`[${status}] #${song.song_id} "${song.title}"`);
  if (issues.length > 0) console.log(`  -> ${issues.join('; ')}`);
  console.log(`  Text(${plainText.length}): ${JSON.stringify(plainText.substring(0, 200))}`);
  console.log(`  Verses: ${verses.length} [${verses.map(v => v.label || '(no label)').join(', ')}]`);
  console.log('');
}
