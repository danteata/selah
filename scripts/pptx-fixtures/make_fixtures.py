"""
Write the small PowerPoint decks the import tests read
(`src-tauri/tests/fixtures/pptx/`). They are built here from minimal OOXML
rather than saved from PowerPoint, so they are ours to redistribute and each
one exercises exactly what a test checks:

- lyric-16x9.pptx: 16:9 with a dark theme, title and body placeholders only,
  a background picture on the master, Twi text (Ɛ, Ɔ), speaker notes, a hidden
  slide with mixed run formatting and one slide with its own background colour.
- announce-4x3.pptx: 4:3 with a light theme and Calibri, bulleted body text, a
  small picture and a chart (both left out), a full-slide photo that becomes
  the background, SmartArt, a group holding a text box, a numbered list, text
  that must be escaped, a gradient background and a full-slide EMF picture
  Selah can't show.

Output is byte-for-byte reproducible (fixed timestamps, fixed entry order).

Usage (standard library only):
    python3 scripts/pptx-fixtures/make_fixtures.py src-tauri/tests/fixtures/pptx
Then refresh the goldens:
    cd src-tauri && UPDATE_GOLDEN=1 cargo test --no-default-features --features ndi,pptx-import pptx_import
"""
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from xml.sax.saxutils import escape

NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
EMU_PER_PT = 12700

WIDE = (12192000, 6858000)  # 13.333 x 7.5 in
STANDARD = (9144000, 6858000)  # 10 x 7.5 in


def png(rgb, w=4, h=4):
    """A solid-colour PNG."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# Enough of an EMF header to be recognisably not a PNG/JPEG.
EMF = struct.pack("<II", 1, 108) + b"\x00" * 100


def rels(items):
    body = "".join(
        f'<Relationship Id="{rid}" Type="{REL}{kind}" Target="{target}"/>' for rid, kind, target in items
    )
    return (
        XML_HEAD
        + f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'
    )


def theme(dark, minor="Calibri", major="Calibri Light"):
    dk1, lt1 = ("000000", "FFFFFF")
    return XML_HEAD + f"""<a:theme {NS} name="Fixture"><a:themeElements>
<a:clrScheme name="Fixture">
<a:dk1><a:srgbClr val="{dk1}"/></a:dk1><a:lt1><a:srgbClr val="{lt1}"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Fixture">
<a:majorFont><a:latin typeface="{major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="{minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Fixture">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>"""


def xfrm(x, y, w, h, tag="a:xfrm"):
    return f'<{tag}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></{tag}>'


def run(text, b=False, i=False, u=False, color=None, font=None, size=None):
    attrs = ' lang="en-US"'
    if size:
        attrs += f' sz="{size}"'
    if b:
        attrs += ' b="1"'
    if i:
        attrs += ' i="1"'
    if u:
        attrs += ' u="sng"'
    inner = ""
    if color:
        inner += f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
    if font:
        inner += f'<a:latin typeface="{font}"/>'
    return f"<a:r><a:rPr{attrs}>{inner}</a:rPr><a:t>{escape(text)}</a:t></a:r>"


def para(*runs, algn=None, lvl=0, bullet=None):
    """bullet: None (inherit), 'none', 'char' or 'num'."""
    attrs = ""
    if lvl:
        attrs += f' lvl="{lvl}"'
    if algn:
        attrs += f' algn="{algn}"'
    bu = {
        None: "",
        "none": "<a:buNone/>",
        "char": '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>',
        "num": '<a:buAutoNum type="arabicPeriod"/>',
    }[bullet]
    ppr = f"<a:pPr{attrs}>{bu}</a:pPr>" if attrs or bu else ""
    if not runs:
        return f'<a:p>{ppr}<a:endParaRPr lang="en-US"/></a:p>'
    return f"<a:p>{ppr}{''.join(runs)}</a:p>"


BR = "<a:br><a:rPr lang=\"en-US\"/></a:br>"


def ph_shape(sid, name, ph, paras, box=None):
    sppr = xfrm(*box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' if box else ""
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
        f"<p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr>{sppr}</p:spPr>"
        f'<p:txBody><a:bodyPr/><a:lstStyle/>{"".join(paras)}</p:txBody></p:sp>'
    )


def text_box(sid, name, box, paras):
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr>{xfrm(*box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
        f'<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>{"".join(paras)}</p:txBody></p:sp>'
    )


def picture(sid, name, rid, box):
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        f'<p:spPr>{xfrm(*box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    )


def chart_frame(sid, rid, box):
    return (
        f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="Chart {sid}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        f'{xfrm(*box, tag="p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        f'<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="{rid}"/></a:graphicData></a:graphic></p:graphicFrame>'
    )


def smartart_frame(sid, box):
    # No relIds to a drawing part, so deckcraft keeps it as an opaque object.
    return (
        f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="Diagram {sid}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        f'{xfrm(*box, tag="p:xfrm")}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:graphic></p:graphicFrame>'
    )


def group(sid, box, child, shapes):
    return (
        f'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{sid}" name="Group {sid}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        f'<p:grpSpPr><a:xfrm><a:off x="{box[0]}" y="{box[1]}"/><a:ext cx="{box[2]}" cy="{box[3]}"/>'
        f'<a:chOff x="{child[0]}" y="{child[1]}"/><a:chExt cx="{child[2]}" cy="{child[3]}"/></a:xfrm></p:grpSpPr>'
        f'{"".join(shapes)}</p:grpSp>'
    )


def sp_tree(shapes):
    return (
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        f'<p:grpSpPr>{xfrm(0, 0, 0, 0)}<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></p:grpSpPr>'
        f'{"".join(shapes)}</p:spTree>'
    )


def bg(fill):
    return f"<p:bg><p:bgPr>{fill}<a:effectLst/></p:bgPr></p:bg>" if fill else ""


def solid(rgb):
    return f'<a:solidFill><a:srgbClr val="{rgb}"/></a:solidFill>'


def gradient(a, b, ang_deg):
    return (
        f'<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="{a}"/></a:gs>'
        f'<a:gs pos="100000"><a:srgbClr val="{b}"/></a:gs></a:gsLst><a:lin ang="{int(ang_deg * 60000)}" scaled="0"/></a:gradFill>'
    )


def blip_fill(rid):
    return f'<a:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'


def master(size, dark, bg_fill, body_bullets):
    w, h = size
    margin = w // 16
    title_box = (margin, h // 20, w - 2 * margin, h // 6)
    body_box = (margin, h // 4, w - 2 * margin, h * 2 // 3)
    cmap = (
        'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"' if dark else 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"'
    )
    if body_bullets:
        lvl1 = '<a:lvl1pPr marL="228600" indent="-228600" algn="l"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>'
    else:
        lvl1 = '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="4000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>'
    lvl2 = '<a:lvl2pPr marL="685800" indent="-228600" algn="l"><a:buFont typeface="Arial"/><a:buChar char="&#8211;"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl2pPr>'
    shapes = [
        ph_shape(2, "Title Placeholder 1", '<p:ph type="title"/>', [para(run("Click to edit Master title style"))], title_box),
        ph_shape(3, "Text Placeholder 2", '<p:ph type="body" idx="1"/>', [para(run("Click to edit Master text styles"))], body_box),
        ph_shape(4, "Footer Placeholder 3", '<p:ph type="ftr" sz="quarter" idx="3"/>', [para(run("Footer"))], (margin, h - h // 10, w // 3, h // 15)),
    ]
    return XML_HEAD + (
        f"<p:sldMaster {NS}><p:cSld>{bg(bg_fill)}{sp_tree(shapes)}</p:cSld>"
        f'<p:clrMap {cmap} accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
        "<p:txStyles>"
        '<p:titleStyle><a:lvl1pPr algn="ctr"><a:buNone/><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
        f"<p:bodyStyle>{lvl1}{lvl2}</p:bodyStyle><p:otherStyle/>"
        "</p:txStyles></p:sldMaster>"
    )


LAYOUT = XML_HEAD + (
    f'<p:sldLayout {NS} type="obj" preserve="1"><p:cSld name="Title and Content">'
    + sp_tree(
        [
            ph_shape(2, "Title 1", '<p:ph type="title"/>', [para(run("Click to edit Master title style"))]),
            ph_shape(3, "Content Placeholder 2", '<p:ph idx="1"/>', [para(run("Click to edit Master text styles"))]),
        ]
    )
    + '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
)


def slide(shapes, bg_fill=None, hidden=False):
    show = ' show="0"' if hidden else ""
    return XML_HEAD + (
        f"<p:sld {NS}{show}><p:cSld>{bg(bg_fill)}{sp_tree(shapes)}</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


def notes(text_lines):
    paras = "".join(para(run(t)) for t in text_lines)
    shapes = [
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>',
        f'<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp>',
    ]
    return XML_HEAD + f"<p:notes {NS}><p:cSld>{sp_tree(shapes)}</p:cSld></p:notes>"


CHART = XML_HEAD + (
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout/>'
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/>'
    '<c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>Sun</c:v></c:pt><c:pt idx="1"><c:v>Wed</c:v></c:pt></c:strLit></c:cat>'
    '<c:val><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>45</c:v></c:pt></c:numLit></c:val>'
    "</c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"
)


def package(size, dark, master_bg, body_bullets, slides, theme_fonts=("Calibri", "Calibri Light")):
    """slides: list of (slide_xml, extra_rels, notes_lines or None); extra parts in `media`."""
    files = {}
    overrides = [
        ("/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),
        ("/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"),
        ("/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"),
        ("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
    ]
    files["_rels/.rels"] = rels([("rId1", "officeDocument", "ppt/presentation.xml")])
    pres_rels = [("rId1", "slideMaster", "slideMasters/slideMaster1.xml"), ("rId2", "theme", "theme/theme1.xml")]
    sld_ids = ""
    media = {}
    for n, (xml, extra, note_lines, parts) in enumerate(slides, start=1):
        rid = f"rId{n + 2}"
        pres_rels.append((rid, "slide", f"slides/slide{n}.xml"))
        sld_ids += f'<p:sldId id="{255 + n}" r:id="{rid}"/>'
        files[f"ppt/slides/slide{n}.xml"] = xml
        overrides.append((f"/ppt/slides/slide{n}.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"))
        srels = [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")] + list(extra)
        if note_lines:
            srels.append(("rIdN", "notesSlide", f"../notesSlides/notesSlide{n}.xml"))
            files[f"ppt/notesSlides/notesSlide{n}.xml"] = notes(note_lines)
            files[f"ppt/notesSlides/_rels/notesSlide{n}.xml.rels"] = rels([("rId1", "slide", f"../slides/slide{n}.xml")])
            overrides.append((f"/ppt/notesSlides/notesSlide{n}.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"))
        files[f"ppt/slides/_rels/slide{n}.xml.rels"] = rels(srels)
        media.update(parts)
    for name, data in media.items():
        files[name] = data
        if name.endswith(".xml"):
            overrides.append(("/" + name, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"))
    w, h = size
    files["ppt/presentation.xml"] = XML_HEAD + (
        f'<p:presentation {NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
        f'<p:sldIdLst>{sld_ids}</p:sldIdLst><p:sldSz cx="{w}" cy="{h}"/><p:notesSz cx="6858000" cy="9144000"/>'
        "</p:presentation>"
    )
    files["ppt/_rels/presentation.xml.rels"] = rels(pres_rels)
    master_rels = [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "theme", "../theme/theme1.xml")]
    if master_bg is not None:
        master_rels.append(("rId3", "image", "../media/master-bg.png"))
        files["ppt/media/master-bg.png"] = master_bg
    files["ppt/slideMasters/slideMaster1.xml"] = master(size, dark, blip_fill("rId3") if master_bg else None, body_bullets)
    files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = rels(master_rels)
    files["ppt/slideLayouts/slideLayout1.xml"] = LAYOUT
    files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")])
    files["ppt/theme/theme1.xml"] = theme(dark, *theme_fonts)
    defaults = (
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Default Extension="emf" ContentType="image/x-emf"/>'
    )
    over = "".join(f'<Override PartName="{p}" ContentType="{t}"/>' for p, t in overrides)
    files["[Content_Types].xml"] = (
        XML_HEAD + f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{defaults}{over}</Types>'
    )
    return files


def write(path, files):
    order = ["[Content_Types].xml", "_rels/.rels"] + sorted(k for k in files if k not in ("[Content_Types].xml", "_rels/.rels"))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in order:
            data = files[name]
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)


def lyric_deck():
    body = '<p:ph idx="1"/>'
    s1 = slide(
        [
            ph_shape(2, "Title 1", '<p:ph type="title"/>', [para(run("Amazing Grace"))]),
            ph_shape(
                3,
                "Content 2",
                body,
                [
                    para(run("Amazing grace, how sweet the sound")),
                    para(run("That saved a wretch like me")),
                    para(run("I once was lost, but now am found")),
                    para(run("Was blind, but now I see")),
                ],
            ),
        ]
    )
    s2 = slide(
        [
            ph_shape(
                3,
                "Content 2",
                body,
                [
                    para(run("Ɛyɛ me dɛ sɛ meyɛ wo dea"), BR, run("Ɔdɔ a ɛnni awieeɛ")),
                    para(),
                    para(run("Nyame ne ɔhene")),
                ],
            ),
        ]
    )
    s3 = slide(
        [
            ph_shape(2, "Title 1", '<p:ph type="title"/>', [para(run("Chorus"))]),
            ph_shape(
                3,
                "Content 2",
                body,
                [
                    para(
                        run("How "),
                        run("great", b=True),
                        run(" is "),
                        run("our God", i=True, u=True, color="FFC000"),
                        run(", sing with me", font="Montserrat"),
                        algn="l",
                    )
                ],
            ),
        ],
        hidden=True,
    )
    s4 = slide(
        [ph_shape(3, "Content 2", body, [para(run("Thank you for worshipping with us"))])],
        bg_fill=solid("1F3864"),
    )
    return package(
        WIDE,
        dark=True,
        master_bg=png((10, 20, 60)),
        body_bullets=False,
        slides=[
            (s1, [], None, {}),
            (s2, [], ["Sing twice", "Key of G"], {}),
            (s3, [], None, {}),
            (s4, [], None, {}),
        ],
    )


def announce_deck():
    w, h = STANDARD
    s1 = slide(
        [
            ph_shape(2, "Title 1", '<p:ph type="title"/>', [para(run("Church Announcements"))]),
            ph_shape(
                3,
                "Content 2",
                '<p:ph idx="1"/>',
                [
                    para(run("Youth camp")),
                    para(run("Register by Friday"), lvl=1),
                    para(run("Choir practice")),
                ],
                (457200, 1600200, 4572000, 3429000),
            ),
            picture(4, "Picture 3", "rId2", (5486400, 1828800, 2743200, 1828800)),
            chart_frame(5, "rId3", (5486400, 3886200, 2743200, 1828800)),
        ]
    )
    s2 = slide(
        [
            picture(2, "Background Photo", "rId2", (0, 0, w, h)),
            text_box(3, "TextBox 2", (914400, 2743200, 7315200, 1371600), [para(run("Welcome!", font="Georgia", size=6000), algn="ctr")]),
            smartart_frame(4, (914400, 4572000, 7315200, 1371600)),
        ]
    )
    s3 = slide(
        [
            group(
                2,
                (914400, 914400, 7315200, 4572000),
                (0, 0, 1463040, 914400),
                [
                    text_box(
                        3,
                        "TextBox 3",
                        (0, 0, 1463040, 457200),
                        [para(run('Fish & Chips <script>alert("x")</script>'), algn="r")],
                    ),
                ],
            ),
            text_box(
                4,
                "TextBox 4",
                (914400, 5029200, 7315200, 1143000),
                [
                    para(run("Pray"), bullet="num"),
                    para(run("Give"), bullet="num"),
                    para(run("Serve", font="Calibri"), bullet="num"),
                ],
            ),
        ],
        bg_fill=gradient("0F0C29", "302B63", 90),
    )
    s4 = slide(
        [
            picture(2, "Logo", "rId2", (0, 0, w, h)),
            ph_shape(3, "Title 1", '<p:ph type="title"/>', [para(run("Offering"))]),
        ],
        bg_fill=solid("FFFFFF"),
    )
    photo = png((200, 120, 40))
    return package(
        STANDARD,
        dark=False,
        master_bg=None,
        body_bullets=True,
        slides=[
            (
                s1,
                [("rId2", "image", "../media/small.png"), ("rId3", "chart", "../charts/chart1.xml")],
                ["Mention the deadline"],
                {"ppt/media/small.png": png((0, 160, 0)), "ppt/charts/chart1.xml": CHART},
            ),
            (s2, [("rId2", "image", "../media/photo.png")], None, {"ppt/media/photo.png": photo}),
            (s3, [], None, {}),
            (s4, [("rId2", "image", "../media/logo.emf")], None, {"ppt/media/logo.emf": EMF}),
        ],
    )


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "src-tauri/tests/fixtures/pptx")
    out.mkdir(parents=True, exist_ok=True)
    write(out / "lyric-16x9.pptx", lyric_deck())
    write(out / "announce-4x3.pptx", announce_deck())
    print(f"wrote {out}/lyric-16x9.pptx and {out}/announce-4x3.pptx")


if __name__ == "__main__":
    main()
