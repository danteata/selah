# Third-party fonts

Selah ships these fonts in the app so slides render the same on every machine,
offline included. They come from the [Fontsource](https://fontsource.org) packages
listed in `package.json`; `scripts/build-slide-fonts-css.mjs` turns them into
`src/styles/slide-fonts.css` (woff2, latin and latin-ext subsets only). The font
files are not modified.

Two families are served under another name, through CSS only:

- **Source Sans Pro** is Adobe's Source Sans 3, under the name it had before the
  rename, so slides saved with the old name keep their font.
- **Georgia** uses an installed Georgia when the machine has one, otherwise
  Gelasio, a metric-compatible replacement. Georgia itself is not distributed.

| Font | Package | Version | Copyright | Licence |
|---|---|---|---|---|
| Inter | `@fontsource/inter` | 5.3.0 | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) | OFL-1.1 |
| Roboto | `@fontsource/roboto` | 5.3.0 | Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic) | OFL-1.1 |
| Open Sans | `@fontsource/open-sans` | 5.3.0 | Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans) | OFL-1.1 |
| Lato | `@fontsource/lato` | 5.3.0 | Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic, with Reserved Font Name "Lato" | OFL-1.1 |
| Montserrat | `@fontsource/montserrat` | 5.3.0 | Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) | OFL-1.1 |
| Source Sans Pro (Source Sans 3 files) | `@fontsource/source-sans-3` | 5.3.0 | Copyright 2010-2020 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' | OFL-1.1 |
| Poppins | `@fontsource/poppins` | 5.3.0 | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins) | OFL-1.1 |
| Nunito | `@fontsource/nunito` | 5.3.0 | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) | OFL-1.1 |
| Raleway | `@fontsource/raleway` | 5.3.0 | Copyright 2010 The Raleway Project Authors, with Reserved Font Name "Raleway" | OFL-1.1 |
| Ubuntu | `@fontsource/ubuntu` | 5.3.0 | Copyright 2010, 2011 Canonical Ltd. | Ubuntu Font Licence 1.0 |
| Playfair Display | `@fontsource/playfair-display` | 5.3.0 | Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display" | OFL-1.1 |
| Georgia fallback (Gelasio) | `@fontsource/gelasio` | 5.3.0 | Copyright 2022 The Gelasio Project Authors (https://github.com/SorkinType/Gelasio) | OFL-1.1 |
| Crimson Pro (app UI) | `@fontsource/crimson-pro` | 5.3.0 | Copyright 2018 The Crimson Pro Project Authors (https://github.com/Fonthausen/CrimsonPro) | OFL-1.1 |
| DM Sans (app UI) | `@fontsource/dm-sans` | 5.3.0 | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) | OFL-1.1 |

## SIL Open Font License, Version 1.1

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Ubuntu Font Licence, Version 1.0

```
-------------------------------
UBUNTU FONT LICENCE Version 1.0
-------------------------------

PREAMBLE
This licence allows the licensed fonts to be used, studied, modified and
redistributed freely. The fonts, including any derivative works, can be
bundled, embedded, and redistributed provided the terms of this licence
are met. The fonts and derivatives, however, cannot be released under
any other licence. The requirement for fonts to remain under this
licence does not require any document created using the fonts or their
derivatives to be published under this licence, as long as the primary
purpose of the document is not to be a vehicle for the distribution of
the fonts.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this licence and clearly marked as such. This may
include source files, build scripts and documentation.

"Original Version" refers to the collection of Font Software components
as received under this licence.

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to
a new environment.

"Copyright Holder(s)" refers to all individuals and companies who have a
copyright ownership of the Font Software.

"Substantially Changed" refers to Modified Versions which can be easily
identified as dissimilar to the Font Software by users of the Font
Software comparing the Original Version with the Modified Version.

To "Propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy. Propagation includes copying,
distribution (with or without modification and with or without charging
a redistribution fee), making available to the public, and in some
countries other activities as well.

PERMISSION & CONDITIONS
This licence does not grant any rights under trademark law and all such
rights are reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to propagate the Font Software, subject to
the below conditions:

1) Each copy of the Font Software must contain the above copyright
notice and this licence. These can be included either as stand-alone
text files, human-readable headers or in the appropriate machine-
readable metadata fields within text or binary files as long as those
fields can be easily viewed by the user.

2) The font name complies with the following:
(a) The Original Version must retain its name, unmodified.
(b) Modified Versions which are Substantially Changed must be renamed to
avoid use of the name of the Original Version or similar names entirely.
(c) Modified Versions which are not Substantially Changed must be
renamed to both (i) retain the name of the Original Version and (ii) add
additional naming elements to distinguish the Modified Version from the
Original Version. The name of such Modified Versions must be the name of
the Original Version, with "derivative X" where X represents the name of
the new work, appended to that name.

3) The name(s) of the Copyright Holder(s) and any contributor to the
Font Software shall not be used to promote, endorse or advertise any
Modified Version, except (i) as required by this licence, (ii) to
acknowledge the contribution(s) of the Copyright Holder(s) or (iii) with
their explicit written permission.

4) The Font Software, modified or unmodified, in part or in whole, must
be distributed entirely under this licence, and must not be distributed
under any other licence. The requirement for fonts to remain under this
licence does not affect any document created using the Font Software,
except any version of the Font Software extracted from a document
created using the Font Software may only be distributed under this
licence.

TERMINATION
This licence becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.
```
