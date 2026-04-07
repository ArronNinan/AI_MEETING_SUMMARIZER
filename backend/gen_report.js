const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, TabStopType, SimpleField, VerticalAlign,
  HeadingLevel, PageBreak
} = require('docx');
const fs = require('fs');

const data     = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT_PATH = process.argv[3];

const {
  filename       = 'Meeting Report',
  meeting_date   = '',
  meeting_time   = '',
  summary        = '',
  attendees      = [],
  agendas        = [],
  key_decisions  = [],
  key_highlights = [],
  action_items   = [],
  topics         = [],
  stats          = {},
  audio_duration_sec = 0,
} = data;

function clean(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\bthe speaker\b/gi, 'the presenter')
    .replace(/\bthe speaker's\b/gi, "the presenter's")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Format seconds to HH:MM:SS or MM:SS
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'Not available';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Truncate text to max length with ellipsis
function truncate(text, maxLen=150) {
  const cleaned = clean(text);
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen).trim() + '...';
}

// ── Black & White palette only ─────────────────────────
const C = {
  black:   '000000',
  darkGry: '1A1A1A',
  midGry:  '404040',
  gry:     '666666',
  ltGry:   'AAAAAA',
  rule:    'CCCCCC',
  rowAlt:  'F2F2F2',
  silver:  'E8E8E8',
  white:   'FFFFFF',
};

const b    = (c=C.rule, sz=3) => ({ style: BorderStyle.SINGLE, size:sz, color:c });
const bAll = (c=C.rule, sz=3) => ({ top:b(c,sz), bottom:b(c,sz), left:b(c,sz), right:b(c,sz) });
const bNone= () => ({ top:b('FFFFFF',0), bottom:b('FFFFFF',0), left:b('FFFFFF',0), right:b('FFFFFF',0) });

const sp  = (bef=0,aft=0,line=276) => ({ spacing:{ before:bef, after:aft, line } });
const r   = (t,o={}) => new TextRun({ text:String(t||''), font:'Cambria', size:22, color:C.darkGry, ...o });
const rb  = (t,o={}) => r(t, { bold:true, ...o });
const ri  = (t,o={}) => r(t, { italics:true, ...o });

const p   = (runs,opts={}) => new Paragraph({ children:Array.isArray(runs)?runs:[runs], ...sp(80,80,296), ...opts });
const gap = (n=200) => new Paragraph({ children:[r('')], ...sp(n,n) });
const br  = () => new Paragraph({ children:[new PageBreak()], spacing:{ before:0, after:0 } });

const cm  = { top:120, bottom:120, left:180, right:180 };
const cms = { top:100, bottom:100, left:160, right:160 };

// Label cell: light grey background, bold black text
const labelCell = (text, w=2600) => new TableCell({
  borders: bAll(C.rule),
  width: { size:w, type:WidthType.DXA },
  margins: cm,
  shading: { fill:C.silver, type:ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({ ...sp(40,40), children:[rb(text,{size:20,color:C.black})] })]
});

// Value cell: white background
const valueCell = (text, w=6760) => new TableCell({
  borders: bAll(C.rule),
  width: { size:w, type:WidthType.DXA },
  margins: cm,
  shading: { fill:C.white, type:ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({ ...sp(40,40), children:[r(clean(text),{size:20})] })]
});

// Header cell: black background, white text
const headCell = (text, w) => new TableCell({
  borders: bAll(C.black, 4),
  width: { size:w, type:WidthType.DXA },
  margins: cms,
  shading: { fill:C.black, type:ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({
    alignment: AlignmentType.CENTER, ...sp(40,40),
    children: [rb(text, { size:19, color:C.white })]
  })]
});

// Data cell: white or light grey alternating, no colour
const dataCell = (text, w, alt=false, center=false) => new TableCell({
  borders: bAll(C.rule),
  width: { size:w, type:WidthType.DXA },
  margins: cms,
  shading: { fill: alt ? C.rowAlt : C.white, type:ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({
    alignment: center?AlignmentType.CENTER:AlignmentType.LEFT, ...sp(40,40),
    children: [r(clean(text), { size:20 })]
  })]
});

// ── Header / Footer ────────────────────────────────────
const docHeader = new Paragraph({
  tabStops: [{ type:TabStopType.RIGHT, position:9360 }],
  border: { bottom: b(C.midGry, 6) },
  spacing: { before:0, after:120 },
  children: [
    rb('OFFICIAL MEETING REPORT', { size:17, color:C.black }),
    r('\t' + [filename, meeting_date].filter(Boolean).join('   |   '), { size:16, color:C.gry }),
  ]
});

const docFooter = new Paragraph({
  tabStops: [{ type:TabStopType.RIGHT, position:9360 }],
  border: { top: b(C.rule, 3) },
  spacing: { before:80, after:0 },
  children: [
    r('Confidential  —  AI Meeting Summarizer', { size:16, color:C.ltGry }),
    r('\tPage ', { size:16, color:C.ltGry }),
    new SimpleField('PAGE'),
    r(' of ', { size:16, color:C.ltGry }),
    new SimpleField('NUMPAGES'),
  ]
});

// ── Section title helper ───────────────────────────────
const sTitle = (num, title) => new Paragraph({
  ...sp(0, 200),
  border: {
    bottom: b(C.midGry, 6),
    left:   { style:BorderStyle.SINGLE, size:28, color:C.black },
  },
  indent: { left:240 },
  children: [rb(num ? `${num}.  ${title}` : title, { size:28, color:C.black })]
});

const sIntro = (text) => new Paragraph({
  ...sp(0, 160, 300),
  alignment: AlignmentType.JUSTIFIED,
  children: [ri(clean(text), { size:21, color:C.gry })]
});

// ══════════════════════════════════════════════════════
//  PAGE 1: COVER (title only, no table)
// ══════════════════════════════════════════════════════
const cover = [
  gap(2200),

  new Paragraph({
    alignment: AlignmentType.CENTER, ...sp(0,20),
    children: [rb('OFFICIAL MEETING REPORT', { size:56, color:C.black })]
  }),

  new Paragraph({
    alignment: AlignmentType.CENTER, ...sp(0,28),
    border: { bottom: b(C.rule, 10) },
    children: [r('')]
  }),

  new Paragraph({
    alignment: AlignmentType.CENTER, ...sp(28,16),
    children: [r(filename, { size:30, color:C.midGry })]
  }),

  new Paragraph({
    alignment: AlignmentType.CENTER, ...sp(0,0),
    children: [ri(
      [meeting_date, meeting_time].filter(Boolean).join('   |   '),
      { size:22, color:C.gry }
    )]
  }),

  br(), // → page 2
];

// ══════════════════════════════════════════════════════
//  PAGE 2: DOCUMENT DETAILS
// ══════════════════════════════════════════════════════
const detailsTable = new Table({
  width: { size:9360, type:WidthType.DXA },
  columnWidths: [2600, 6760],
  rows: [
    ['Meeting Title',        filename],
    ['Date of Meeting',      meeting_date  || 'Not specified'],
    ['Time of Meeting',      meeting_time  || 'Not specified'],
    ['Audio Duration',       formatDuration(audio_duration_sec)],
    ['Number of Speakers',   attendees.length ? String(attendees.length) : 'Not available'],
    ['Total Word Count',     stats.total_words ? `${stats.total_words} words` : 'Not available'],
    ['Document Type',        'Meeting Report & Minutes'],
    ['Classification',       'Confidential'],
    ['Prepared By',          'AI Meeting Summarizer'],
  ].map(([k,v],i) => new TableRow({ children:[
    labelCell(k, 2600),
    new TableCell({
      borders: bAll(C.rule),
      width: { size:6760, type:WidthType.DXA },
      margins: cm,
      shading: { fill: i%2===0 ? C.white : C.rowAlt, type:ShadingType.CLEAR },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ ...sp(40,40), children:[r(clean(v),{size:20})] })]
    }),
  ]}))
});

const page2 = [
  sTitle('', 'Document Details'),
  gap(80),
  sIntro('The following table provides complete details of this meeting report, including the meeting title, date, time, and classification information.'),
  gap(60),
  detailsTable,
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 3: EXECUTIVE SUMMARY
// ══════════════════════════════════════════════════════
const summaryBlock = new Table({
  width: { size:9360, type:WidthType.DXA },
  columnWidths: [9360],
  rows: [new TableRow({ children: [new TableCell({
    borders: bAll(C.midGry, 5),
    width: { size:9360, type:WidthType.DXA },
    margins: { top:220, bottom:220, left:280, right:280 },
    shading: { fill:C.white, type:ShadingType.CLEAR },
    children: [new Paragraph({
      ...sp(60,60,320),
      alignment: AlignmentType.JUSTIFIED,
      children: [r(truncate(summary || 'No summary available for this meeting.', 600), { size:22 })]
    })]
  })]})]
});

const page3 = [
  sTitle(1, 'Executive Summary'),
  gap(80),
  sIntro('The following is a structured summary of the key discussions, outcomes, and decisions reached during this meeting.'),
  gap(60),
  summaryBlock,
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 4: MEETING AGENDA
// ══════════════════════════════════════════════════════
const agendaTable = agendas.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 7860, 800],
      rows: [
        new TableRow({ children:[headCell('No.',700), headCell('Agenda Item',7860), headCell('Status',800)] }),
        ...agendas.slice(0, 5).map((a,i) => new TableRow({ children:[
          dataCell(String(i+1), 700,  i%2!==0, true),
          dataCell(truncate(a, 150),           7860, i%2!==0),
          dataCell('Discussed', 800,  i%2!==0, true),
        ]}))
      ]
    })
  : null;

const page4 = [
  sTitle(2, 'Meeting Agenda'),
  gap(80),
  sIntro('The following agenda items were tabled and discussed during the course of this meeting.'),
  gap(60),
  agendaTable || p([ri('No agenda items were identified from this meeting.', { color:C.gry })]),
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 5: KEY DECISION POINTS
// ══════════════════════════════════════════════════════
const decisionsTable = key_decisions.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 8660],
      rows: [
        new TableRow({ children:[headCell('No.',700), headCell('Decision',8660)] }),
        ...key_decisions.slice(0, 5).map((d,i) => new TableRow({ children:[
          dataCell(String(i+1), 700,  i%2!==0, true),
          dataCell(truncate(d, 180),           8660, i%2!==0),
        ]}))
      ]
    })
  : null;

const page5 = [
  sTitle(3, 'Key Decision Points'),
  gap(80),
  sIntro('The following decisions were formally agreed upon or resolved during the meeting and are recorded here for reference.'),
  gap(60),
  decisionsTable || p([ri('No formal decisions were identified from this meeting.', { color:C.gry })]),
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 6: KEY HIGHLIGHTS
// ══════════════════════════════════════════════════════
const highlightsTable = key_highlights.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 8660],
      rows: [
        new TableRow({ children:[headCell('No.',700), headCell('Key Highlight',8660)] }),
        ...key_highlights.slice(0, 5).map((h,i) => new TableRow({ children:[
          dataCell(String(i+1), 700,  i%2!==0, true),
          dataCell(truncate(h, 180),           8660, i%2!==0),
        ]}))
      ]
    })
  : null;

const page6 = [
  sTitle(4, 'Key Highlights'),
  gap(80),
  sIntro('The following highlights represent the most significant observations and notable points raised during the meeting.'),
  gap(60),
  highlightsTable || p([ri('No key highlights were identified from this meeting.', { color:C.gry })]),
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 7: ACTION ITEMS
// ══════════════════════════════════════════════════════
const actionTable = action_items.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 5960, 1700, 1000],
      rows: [
        new TableRow({ children:[
          headCell('No.',700), headCell('Action Item',5960),
          headCell('Owner',1700), headCell('Status',1000),
        ]}),
        ...action_items.slice(0, 5).map((a,i) => {
          const txt   = typeof a==='object'?(a.item||String(a)):String(a);
          const owner = typeof a==='object'?(a.owner||'TBD'):'TBD';
          return new TableRow({ children:[
            dataCell(String(i+1), 700,  i%2!==0, true),
            dataCell(truncate(txt, 150),         5960, i%2!==0),
            dataCell(owner,       1700, i%2!==0, true),
            dataCell('Pending',   1000, i%2!==0, true),
          ]});
        })
      ]
    })
  : null;

const page7 = [
  sTitle(5, 'Action Items'),
  gap(80),
  sIntro('The following action items have been identified and require follow-up after this meeting. Each item is assigned a responsible party and a current status.'),
  gap(60),
  actionTable || p([ri('No action items were identified from this meeting.', { color:C.gry })]),
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  PAGE 8: DISCUSSION TOPICS (if available)
// ══════════════════════════════════════════════════════
const topicsTable = topics.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 7460, 1200],
      rows: [
        new TableRow({ children:[headCell('No.',700), headCell('Discussion Topic',7460), headCell('Coverage',1200)] }),
        ...topics.slice(0, 5).map((t,i) => new TableRow({ children:[
          dataCell(String(i+1),                        700,  i%2!==0, true),
          dataCell(truncate(t.topic||t, 120),         7460, i%2!==0),
          dataCell(t.duration_pct?`${t.duration_pct}%`:'—', 1200, i%2!==0, true),
        ]}))
      ]
    })
  : null;

const page8 = topicsTable ? [
  sTitle(6, 'Discussion Topics'),
  gap(80),
  sIntro('The following topics were identified as the primary areas of discussion during this meeting, with an estimated share of total discussion time.'),
  gap(60),
  topicsTable,
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
] : [];

// ══════════════════════════════════════════════════════
//  PAGE 9: ATTENDEES
// ══════════════════════════════════════════════════════
const attNum = topicsTable ? 7 : 6;

const attendeesTable = attendees.length > 0
  ? new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [700, 4960, 2500, 1200],
      rows: [
        new TableRow({ children:[
          headCell('No.',700), headCell('Participant',4960),
          headCell('Contribution',2500), headCell('Duration',1200),
        ]}),
        ...attendees.slice(0, 10).map((a,i) => {
          const total = attendees.reduce((s,x)=>s+x.speaking_time,0);
          const pct   = total>0?Math.round((a.speaking_time/total)*100):0;
          const m=Math.floor(a.speaking_time/60), s=a.speaking_time%60;
          return new TableRow({ children:[
            dataCell(String(i+1),             700,  i%2!==0, true),
            dataCell(`Participant ${i+1}`,    4960, i%2!==0),
            dataCell(`${pct}% of discussion`, 2500, i%2!==0, true),
            dataCell(m>0?`${m}m ${s}s`:`${s}s`, 1200, i%2!==0, true),
          ]});
        })
      ]
    })
  : null;

const page9 = [
  sTitle(attNum, 'Attendees & Participation'),
  gap(80),
  sIntro('The following table summarises the participation of each attendee based on speaking time and overall contribution to the discussion.'),
  gap(60),
  attendeesTable || p([ri('No attendee data is available for this meeting.', { color:C.gry })]),
  gap(80),
  new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 4) },
    children: [r('')]
  }),
  gap(120),
];

// ══════════════════════════════════════════════════════
//  FINAL PAGE: SIGN-OFF
// ══════════════════════════════════════════════════════
const signNum = attNum + 1;

const signoffTable = new Table({
  width: { size:9360, type:WidthType.DXA },
  columnWidths: [3120, 3120, 3120],
  rows: [
    new TableRow({ children:[
      headCell('Prepared By',3120), headCell('Reviewed By',3120), headCell('Approved By',3120)
    ]}),
    new TableRow({ children:[
      dataCell('AI Meeting Summarizer',3120,false),
      dataCell('',3120,false), dataCell('',3120,false),
    ]}),
    new TableRow({ children:[
      dataCell('Date: '+(meeting_date||'_______________'),3120,true),
      dataCell('Date: _______________',3120,true,true),
      dataCell('Date: _______________',3120,true,true),
    ]}),
    new TableRow({ children:[
      dataCell('Signature: _______________',3120,false,true),
      dataCell('Signature: _______________',3120,false,true),
      dataCell('Signature: _______________',3120,false,true),
    ]}),
  ]
});

const pageSignoff = [
  sTitle(signNum, 'Approval & Sign-Off'),
  gap(80),
  sIntro('This report has been prepared by the AI Meeting Summarizer. Please review, complete the sign-off below, and retain a copy for official records.'),
  gap(80),
  signoffTable,
  gap(160),
  p([rb('Notes:', { size:21, color:C.black })]),
  gap(40),
  ...[1,2,3,4].map(() => new Paragraph({
    ...sp(0,0),
    border: { bottom: b(C.rule, 3) },
    children: [r('')]
  })),
  gap(100),
];

// ══════════════════════════════════════════════════════
//  ASSEMBLE & BUILD
// ══════════════════════════════════════════════════════
const content = [
  ...cover, ...page2, ...page3, ...page4,
  ...page5, ...page6, ...page7, ...page8,
  ...page9, ...pageSignoff,
];

const doc = new Document({
  numbering: {
    config: [
      { reference:'bullets', levels:[{ level:0, format:LevelFormat.BULLET, text:'•',
          alignment:AlignmentType.LEFT, style:{ paragraph:{ indent:{ left:720, hanging:360 } } } }] },
      { reference:'numbers', levels:[{ level:0, format:LevelFormat.DECIMAL, text:'%1.',
          alignment:AlignmentType.LEFT, style:{ paragraph:{ indent:{ left:720, hanging:360 } } } }] },
    ]
  },
  styles: {
    default: { document: { run: { font:'Cambria', size:22, color:C.darkGry } } },
    paragraphStyles: [
      { id:'Heading1', name:'Heading 1', basedOn:'Normal', next:'Normal', quickFormat:true,
        run:{ size:28, bold:true, font:'Cambria', color:C.black },
        paragraph:{ spacing:{ before:320, after:160 }, outlineLevel:0 } },
    ]
  },
  sections: [{
    properties: {
      page: { size:{ width:12240, height:15840 }, margin:{ top:1080, right:1260, bottom:1080, left:1260 } }
    },
    headers: { default: new Header({ children:[docHeader] }) },
    footers: { default: new Footer({ children:[docFooter] }) },
    children: content,
  }]
});

Packer.toBuffer(doc)
  .then(buf => { fs.writeFileSync(OUT_PATH, buf); console.log('OK'); })
  .catch(e  => { console.error('ERROR:', e.message); process.exit(1); });