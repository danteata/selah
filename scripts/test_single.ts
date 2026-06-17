import { parseRTF } from '../src/services/migration/rtfParser';
import * as fs from 'fs';

const rtf = fs.readFileSync('/tmp/rtf_3386.txt', 'utf-8');
const text = parseRTF(rtf);

// Find the I\m part
const idx = text.indexOf('\\m');
if (idx >= 0) {
  console.log(`Found \\m at index ${idx}`);
  console.log(`Context: ...${JSON.stringify(text.substring(Math.max(0, idx-30), idx+30))}...`);
}

// Also check: what about songs with "Slide N" labels
// Let's look at song 10
import { execSync } from 'child_process';
execSync(`sqlite3 SongWords.db "SELECT writefile('/tmp/rtf_10.txt', words) FROM word WHERE song_id = 10"`, { cwd: '/Users/danielabakah/code/JS/selah' });
const rtf10 = fs.readFileSync('/tmp/rtf_10.txt', 'utf-8');
console.log('\n=== Song 10 RTF (first 800 chars) ===');
console.log(rtf10.substring(0, 800));
console.log('\n=== Song 10 parsed ===');
const text10 = parseRTF(rtf10);
console.log(text10.substring(0, 400));

// Song 100 - African language with unicode escapes
execSync(`sqlite3 SongWords.db "SELECT writefile('/tmp/rtf_100.txt', words) FROM word WHERE song_id = 100"`, { cwd: '/Users/danielabakah/code/JS/selah' });
const rtf100 = fs.readFileSync('/tmp/rtf_100.txt', 'utf-8');
console.log('\n=== Song 100 RTF (first 500 chars) ===');
console.log(rtf100.substring(0, 500));
const text100 = parseRTF(rtf100);
console.log('\n=== Song 100 parsed ===');
console.log(text100.substring(0, 400));
