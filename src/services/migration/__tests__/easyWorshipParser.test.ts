/**
 * Tests for RTF Parser and EasyWorship Parser
 * Run with: npm test -- src/services/migration/__tests__/easyWorshipParser.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseRTF, extractVerseStructureFromRTF } from '../rtfParser';

// Sample RTF from EasyWorship data
const sampleRTF = `{\\rtf1\\ansi\\deff0\\deftab254{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}{\\f1\\fnil\\fcharset0 Verdana;}}{\\colortbl\\red0\\green0\\blue0;\\red255\\green0\\blue0;\\red0\\green128\\blue0;\\red0\\green0\\blue255;\\red255\\green255\\blue0;\\red255\\green0\\blue255;\\red128\\green0\\blue128;\\red128\\green0\\blue0;\\red0\\green255\\blue0;\\red0\\green255\\blue255;\\red0\\green128\\blue128;\\red0\\green0\\blue128;\\red255\\green255\\blue255;\\red192\\green192\\blue192;\\red128\\green128\\blue128;\\red255\\green255\\blue255;}\\paperw12240\\paperh15840\\margl1880\\margr1880\\margt1440\\margb1440{\\*\\pnseclvl1\\pnucrm\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{\\pntxta{.}}}
{\\*\\pnseclvl2\\pnucltr\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{\\pntxta{.}}}
{\\*\\pnseclvl3\\pndec\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{\\pntxta{.}}}
{\\*\\pnseclvl4\\pnlcltr\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{\\pntxta{)}}}
{\\*\\pnseclvl5\\pndec\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{(}}{\\pntxta{)}}}
{\\*\\pnseclvl6\\pnlcltr\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{(}}{\\pntxta{)}}}
{\\*\\pnseclvl7\\pnlcrm\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{(}}{\\pntxta{)}}}
{\\*\\pnseclvl8\\pnlcltr\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{(}}{\\pntxta{)}}}
{\\*\\pnseclvl9\\pndec\\pnstart1\\pnhang\\pnindent720{\\pntxtb}{(}}{\\pntxta{)}}}
{\\pard\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Chorus 1\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Come to my soul, blessed Jesus.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Hear me, O Savior divine.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Open the fountain and cleanse me.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Give me a heart a heart like Thine. \\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Verse 1\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Give me a love that knows no ill.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Give me the grace to do Thy will.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Pardon and cleanse this soul of mine.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Give me a heart like Thine. \\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Verse 2\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Only a joy, a few brief years,\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Only a dream, a vale of tears;\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Vain is this world, I now resign.\\par
\\li0\\fi0\\ri0\\sb0\\sl\\sa0 \\plain\\f1\\fntnamaut Give me a heart like Thine. \\par
}`;

describe('RTF Parser', () => {
    describe('parseRTF', () => {
        it('should return empty string for null/undefined input', () => {
            expect(parseRTF(null as any)).toBe('');
            expect(parseRTF(undefined as any)).toBe('');
            expect(parseRTF('')).toBe('');
        });

        it('should return plain text as-is if not RTF format', () => {
            const plainText = 'This is plain text';
            expect(parseRTF(plainText)).toBe(plainText);
        });

        it('should parse RTF and extract plain text', () => {
            const result = parseRTF(sampleRTF);

            // Should contain the lyrics
            expect(result).toContain('Come to my soul, blessed Jesus');
            expect(result).toContain('Hear me, O Savior divine');
            expect(result).toContain('Give me a heart like Thine');
        });

        it('should handle \\par as newlines', () => {
            const result = parseRTF(sampleRTF);

            // Should have multiple lines
            const lines = result.split('\n');
            expect(lines.length).toBeGreaterThan(1);
        });

        it('should skip destination groups (fonttbl, colortbl, etc.)', () => {
            const result = parseRTF(sampleRTF);

            // Should not contain RTF control words
            expect(result).not.toContain('fonttbl');
            expect(result).not.toContain('colortbl');
            expect(result).not.toContain('pnseclvl');
        });

        it('should handle escaped special characters', () => {
            const rtfWithEscapes = '{\\rtf1 Hello \\\\ World \\{ \\} }';
            const result = parseRTF(rtfWithEscapes);

            expect(result).toContain('\\');
            expect(result).toContain('{');
            expect(result).toContain('}');
        });

        it('should handle hex escapes', () => {
            // \'e9 = é
            const rtfWithHex = '{\\rtf1 Caf\\\'e9}';
            const result = parseRTF(rtfWithHex);

            expect(result).toContain('Caf');
        });

        it('should handle unicode escapes', () => {
            // \u233 = é
            const rtfWithUnicode = '{\\rtf1 Caf\\u233?}';
            const result = parseRTF(rtfWithUnicode);

            expect(result).toContain('Caf');
        });
    });

    describe('extractVerseStructureFromRTF', () => {
        it('should extract verses with labels', () => {
            const verses = extractVerseStructureFromRTF(sampleRTF);

            // Should have extracted verses
            expect(verses.length).toBeGreaterThan(0);

            // Should have Verse 1 and Verse 2
            const verse1 = verses.find(v => v.label === 'Verse 1');
            const verse2 = verses.find(v => v.label === 'Verse 2');

            expect(verse1).toBeDefined();
            expect(verse2).toBeDefined();

            expect(verse1?.content).toContain('Give me a love that knows no ill');
            expect(verse2?.content).toContain('Only a joy, a few brief years');
        });

        it('should extract chorus', () => {
            const verses = extractVerseStructureFromRTF(sampleRTF);

            // The first verse contains Chorus 1 content
            // Note: Chorus 1 appears at the start and may be captured differently
            const firstVerse = verses[0];
            expect(firstVerse).toBeDefined();

            // Chorus content should be present somewhere
            const hasChorusContent = verses.some(v =>
                v.content.includes('Come to my soul, blessed Jesus')
            );
            expect(hasChorusContent).toBe(true);
        });

        it('should return single verse for plain text without labels', () => {
            const plainText = 'Just some lyrics\nWithout verse markers';
            const verses = extractVerseStructureFromRTF(plainText);

            expect(verses.length).toBe(1);
            expect(verses[0].label).toBe('');
            expect(verses[0].content).toBe(plainText);
        });

        it('should handle empty input', () => {
            const verses = extractVerseStructureFromRTF('');
            expect(verses.length).toBe(0);
        });

        it('should handle various verse label formats', () => {
            const rtf = `{\\rtf1
Verse 1\\par
First verse content\\par
\\par
Chorus\\par
Chorus content\\par
\\par
Bridge\\par
Bridge content\\par
\\par
Tag\\par
Tag content\\par
}`;

            const verses = extractVerseStructureFromRTF(rtf);

            expect(verses.find(v => v.label === 'Verse 1')).toBeDefined();
            expect(verses.find(v => v.label === 'Chorus')).toBeDefined();
            expect(verses.find(v => v.label === 'Bridge')).toBeDefined();
            expect(verses.find(v => v.label === 'Tag')).toBeDefined();
        });

        // Regression: EasyWorship 6/7 wraps every line in its own group with a
        // long EasyWorship-specific header (\sdewparatemplatestyle101, etc.)
        // and inline `{\*\sdfsreal 60}{\*\sdfsdef 93.75}` font/size markers
        // between the header and the text. Two bugs previously broke this:
        //   1. The parser treated `\sdewparatemplatestyle101` as a destination
        //      and skipped the entire group, returning an empty string.
        //   2. The `\*\sdfsreal 60` form leaked the "60" into the output AND
        //      the first `\par` ended processing because `skipNextGroup` was
        //      sticky across group boundaries, eating the rest of the song.
        it('should parse EasyWorship 6/7 per-line groups without leaking control values', () => {
            const ewHeader = '{\\rtf1\\ansi\\deff0\\sdeasyworship2\\par';
            const ewLine1 = '{\\pard\\qc\\qdef\\sdewparatemplatestyle101\\plain\\sdewtemplatestyle101\\fs120{\\*\\sdfsreal 60}{\\*\\sdfsdef 93.75}There is an outpouring of abundance\\par}';
            const ewLine2 = '{\\pard\\qc\\qdef\\sdewparatemplatestyle101\\plain\\sdewtemplatestyle101\\fs120{\\*\\sdfsreal 60}{\\*\\sdfsdef 93.75}new doors have been opened\\par}';
            const ewClose = '}';
            const rtf = ewHeader + ewLine1 + ewLine2 + ewClose;

            const result = parseRTF(rtf);

            // Both lines must be present, neither should be preceded by
            // the leaked "60" from the font-size property.
            expect(result).not.toMatch(/^60/);
            expect(result).not.toContain('60There');
            expect(result).toContain('There is an outpouring of abundance');
            expect(result).toContain('new doors have been opened');

            // The control words themselves must not appear in the output.
            expect(result).not.toContain('sdewparatemplatestyle');
            expect(result).not.toContain('sdfsreal');
            expect(result).not.toContain('sdfsdef');
        });
    });
});

describe('EasyWorship Parser Integration', () => {
    // These tests would require sql.js which needs browser environment
    // For now, we test the RTF parsing which is the core functionality

    it('should correctly parse a complete song from RTF', () => {
        const verses = extractVerseStructureFromRTF(sampleRTF);

        // Verify all verses are extracted
        expect(verses.length).toBe(3); // Chorus 1, Verse 1, Verse 2

        // Verify content is clean (no RTF artifacts)
        for (const verse of verses) {
            expect(verse.content).not.toContain('\\par');
            expect(verse.content).not.toContain('\\plain');
            expect(verse.content).not.toContain('\\fntnamaut');
        }
    });
});
