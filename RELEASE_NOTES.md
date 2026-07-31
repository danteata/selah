## Selah 0.1.14

The alternate output, finished properly — plus a verse reference that is finally the right size everywhere.

### Alternate output
- **Send it to a display.** Choosing a monitor now opens a second output window there, running the same view as the projector — so it renders everything, backgrounds and video included.
- **Show the same content in a different form.** A new Layout setting draws the alternate output as a lower third whatever the slide's own layout says, so one verse can be a full slide on the projector and a bar on the stream, switching together with no extra work.
- **Use your own design.** Pick one of your lower-third templates for the output itself. Your styling then applies to whatever passes through it, instead of only to slides that happen to be built from that template.
- Send anything to the output from where you find it: the Bible and dictionary panels now have an Alt button beside Add and Live, and so does every slide in the queue — in both the card and the compact list views.
- Songs and hymns deliberately don't offer it. They are groups of slides and this output holds one, so set it to follow the main output for those.

### Verse references
- **References are the size you'd expect at 100%.** The default was small enough that people set 200% on every slide to compensate; that size is now the default. If you had raised it, set it back to 100%.
- The reference size setting now works on lower thirds. It previously appeared to do nothing there.
- References on the alternate output are drawn in the colour, weight and size you set. They were coming out plain white, and on a lower third they weren't drawn at all.
- A verse and its reference sit together as a block in a lower third, instead of the reference drifting to the bottom of the bar when the verse wrapped.

### Lower thirds
- A verse gets two lines in the bar instead of being squeezed onto one, so it stays readable.
- Bold, italics and colour from the editor are preserved on the alternate output.

### Fixes
- Verse text on the alternate output is no longer tiny — it fills its frame the way the projector does.
- A slide with an image or video background still sends its text over NDI, rather than an empty frame. Use a display for that output if you need the background too.
- Template pickers are where the buttons are. The dictionary, songs and hymns panels had theirs hidden inside a detail view, and the songs & hymns search had none at all, so nothing found there could be styled.
- Long song titles no longer push Add and Live off the edge of the list.
