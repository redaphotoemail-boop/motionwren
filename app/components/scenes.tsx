/* Illustrated stand-in listing photographs for the marketing film.
   Each scene is a 16:9 vector "photo" (1600×900) composed so the centre also
   reads well when cropped to 9:16 or 1:1. Swap for real listing footage when
   a licensed property film is available. */

type SceneProps = { uid: string };

const grainFilter = (id: string) => (
  <filter id={id} x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n" />
    <feColorMatrix in="n" type="saturate" values="0" />
    <feComponentTransfer>
      <feFuncA type="linear" slope="0.09" />
    </feComponentTransfer>
  </filter>
);

export function SceneExterior({ uid }: SceneProps) {
  const id = (name: string) => `${name}-${uid}`;
  const mullions = Array.from({ length: 9 }, (_, index) => 430 + index * 92);
  const upperMullions = Array.from({ length: 4 }, (_, index) => 636 + index * 92);
  const slats = Array.from({ length: 14 }, (_, index) => 1012 + index * 23);
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0F1428" />
          <stop offset=".42" stopColor="#25305A" />
          <stop offset=".66" stopColor="#5E4D73" />
          <stop offset=".78" stopColor="#C98763" />
          <stop offset=".86" stopColor="#EDB777" />
        </linearGradient>
        <radialGradient id={id("sun")} cx="1180" cy="690" r="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F6C27F" stopOpacity=".75" />
          <stop offset="1" stopColor="#F6C27F" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("glass")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE2B0" />
          <stop offset=".55" stopColor="#F7C17A" />
          <stop offset="1" stopColor="#E89A45" />
        </linearGradient>
        <linearGradient id={id("upperGlass")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFDCA6" />
          <stop offset="1" stopColor="#EFA858" />
        </linearGradient>
        <linearGradient id={id("wood")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3A2C22" />
          <stop offset="1" stopColor="#24201E" />
        </linearGradient>
        <linearGradient id={id("pool")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B2B3A" />
          <stop offset="1" stopColor="#0C141D" />
        </linearGradient>
        <linearGradient id={id("lawn")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141A16" />
          <stop offset="1" stopColor="#090C0A" />
        </linearGradient>
        <radialGradient id={id("vignette")} cx="50%" cy="48%" r="75%">
          <stop offset=".55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#05070C" stopOpacity=".55" />
        </radialGradient>
        <filter id={id("soft")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18" /></filter>
        <filter id={id("softer")} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="42" /></filter>
        <filter id={id("haze")} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3" /></filter>
        {grainFilter(id("grain"))}
      </defs>

      <rect width="1600" height="900" fill={`url(#${id("sky")})`} />
      <rect width="1600" height="900" fill={`url(#${id("sun")})`} />
      <g fill="#F3F1EC">
        <circle cx="212" cy="88" r="1.4" opacity=".7" /><circle cx="388" cy="152" r="1.1" opacity=".5" />
        <circle cx="610" cy="64" r="1.3" opacity=".6" /><circle cx="902" cy="118" r="1" opacity=".45" />
        <circle cx="1104" cy="58" r="1.5" opacity=".65" /><circle cx="1322" cy="132" r="1.1" opacity=".5" />
        <circle cx="1490" cy="74" r="1.2" opacity=".55" /><circle cx="760" cy="196" r=".9" opacity=".4" />
      </g>

      {/* distant ridge and tree line */}
      <path d="M0 640 C160 600 300 612 430 626 C600 644 720 600 900 612 C1080 624 1220 588 1380 604 C1480 614 1550 620 1600 616 L1600 720 L0 720 Z" fill="#2A2C4A" opacity=".75" filter={`url(#${id("haze")})`} />
      <g fill="#10131F" filter={`url(#${id("haze")})`}>
        <ellipse cx="120" cy="650" rx="170" ry="120" />
        <ellipse cx="300" cy="670" rx="140" ry="96" />
        <ellipse cx="1360" cy="660" rx="150" ry="110" />
        <ellipse cx="1520" cy="640" rx="170" ry="138" />
      </g>

      {/* warm spill behind the glass */}
      <ellipse cx="800" cy="610" rx="520" ry="150" fill="#F5B566" opacity=".28" filter={`url(#${id("softer")})`} />

      {/* lower volume */}
      <rect x="352" y="512" width="904" height="12" fill="#E6E1D8" />
      <rect x="370" y="524" width="868" height="182" fill="#17191E" />
      <rect x="412" y="540" width="776" height="156" fill={`url(#${id("glass")})`} />
      <rect x="412" y="540" width="776" height="10" fill="#C9864A" opacity=".55" />
      <g fill="#FFF3DA">{[470, 590, 710, 830, 950, 1070].map((x) => <circle key={x} cx={x} cy="545" r="2.2" />)}</g>
      <g fill="#7A4A22" opacity=".22" filter={`url(#${id("haze")})`}>
        <rect x="500" y="648" width="230" height="34" rx="14" />
        <rect x="512" y="630" width="206" height="26" rx="10" />
        <ellipse cx="900" cy="672" rx="70" ry="12" />
        <rect x="1060" y="600" width="70" height="90" rx="8" />
      </g>
      <g stroke="#7A4A22" strokeWidth="2" opacity=".25"><line x1="880" y1="550" x2="880" y2="612" /><line x1="920" y1="550" x2="920" y2="600" /></g>
      <g fill="#FFF0D0" opacity=".9"><circle cx="880" cy="616" r="7" /><circle cx="920" cy="604" r="7" /></g>
      <g fill="#141519">{mullions.map((x) => <rect key={x} x={x} y="540" width="5" height="156" />)}</g>

      {/* upper cantilevered volume */}
      <rect x="548" y="370" width="828" height="12" fill="#ECE7DE" />
      <rect x="566" y="382" width="792" height="130" fill={`url(#${id("wood")})`} />
      <rect x="610" y="402" width="380" height="94" fill={`url(#${id("upperGlass")})`} />
      <g fill="#16161A">{upperMullions.map((x) => <rect key={x} x={x} y="402" width="4" height="94" />)}</g>
      <g stroke="#4A3A2C" strokeWidth="3" opacity=".7">{slats.map((x) => <line key={x} x1={x} y1="396" x2={x} y2="500" />)}</g>
      <rect x="566" y="512" width="792" height="6" fill="#0D0E11" opacity=".6" />

      {/* terrace, light spill */}
      <rect x="300" y="706" width="1010" height="16" fill="#3B3A3E" />
      <ellipse cx="800" cy="716" rx="430" ry="18" fill="#F7C88A" opacity=".35" filter={`url(#${id("soft")})`} />

      {/* reflecting pool */}
      <rect x="300" y="722" width="1010" height="98" fill={`url(#${id("pool")})`} />
      <g opacity=".55" filter={`url(#${id("soft")})`}>
        <rect x="430" y="730" width="740" height="56" fill="#F2B56C" opacity=".6" />
        <rect x="630" y="790" width="340" height="22" fill="#F2B56C" opacity=".35" />
      </g>
      <g stroke="#0E1822" strokeWidth="2" opacity=".35">
        <line x1="420" y1="748" x2="1180" y2="748" /><line x1="470" y1="768" x2="1120" y2="768" />
        <line x1="440" y1="792" x2="1160" y2="792" />
      </g>
      <rect x="300" y="722" width="1010" height="3" fill="#E6E1D8" opacity=".5" />

      {/* foreground */}
      <path d="M0 720 L300 722 L300 820 L1310 820 L1310 722 L1600 720 L1600 900 L0 900 Z" fill={`url(#${id("lawn")})`} />
      <g fill="#0B0E0C">
        <ellipse cx="1440" cy="760" rx="120" ry="70" />
        <ellipse cx="170" cy="770" rx="140" ry="64" />
      </g>
      <g fill="#F7CD8F">
        <circle cx="352" cy="714" r="3" /><circle cx="1256" cy="714" r="3" />
      </g>
      <g fill="#F7CD8F" opacity=".35" filter={`url(#${id("soft")})`}>
        <circle cx="352" cy="714" r="22" /><circle cx="1256" cy="714" r="22" />
      </g>

      <rect width="1600" height="900" fill={`url(#${id("vignette")})`} />
      <rect width="1600" height="900" filter={`url(#${id("grain")})`} />
    </svg>
  );
}

export function SceneLiving({ uid }: SceneProps) {
  const id = (name: string) => `${name}-${uid}`;
  const boards = Array.from({ length: 13 }, (_, index) => index);
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id("wall")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EFE9DF" />
          <stop offset="1" stopColor="#E3DACB" />
        </linearGradient>
        <linearGradient id={id("side")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#CFC5B5" />
          <stop offset="1" stopColor="#E2D9CA" />
        </linearGradient>
        <linearGradient id={id("sideR")} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#C9BEAD" />
          <stop offset="1" stopColor="#DFD5C5" />
        </linearGradient>
        <linearGradient id={id("ceil")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E9E3D9" />
          <stop offset="1" stopColor="#F3EEE6" />
        </linearGradient>
        <linearGradient id={id("floor")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B88A5C" />
          <stop offset="1" stopColor="#7E5A3A" />
        </linearGradient>
        <linearGradient id={id("view")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9DB4C8" />
          <stop offset=".55" stopColor="#E6CFAE" />
          <stop offset=".7" stopColor="#F2C891" />
          <stop offset="1" stopColor="#8C9877" />
        </linearGradient>
        <linearGradient id={id("sofa")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D9D1C4" />
          <stop offset="1" stopColor="#BDB3A4" />
        </linearGradient>
        <linearGradient id={id("stone")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E6DCCB" />
          <stop offset="1" stopColor="#C9BCA6" />
        </linearGradient>
        <radialGradient id={id("vignette")} cx="50%" cy="50%" r="75%">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#2A1E12" stopOpacity=".42" />
        </radialGradient>
        <filter id={id("blur")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16" /></filter>
        <filter id={id("blurS")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id={id("glow")} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="30" /></filter>
        {grainFilter(id("grain"))}
      </defs>

      {/* room shell */}
      <polygon points="0,0 1600,0 1330,120 270,120" fill={`url(#${id("ceil")})`} />
      <polygon points="0,0 270,120 270,660 0,900" fill={`url(#${id("side")})`} />
      <polygon points="1600,0 1330,120 1330,660 1600,900" fill={`url(#${id("sideR")})`} />
      <rect x="270" y="120" width="1060" height="540" fill={`url(#${id("wall")})`} />
      <polygon points="270,660 1330,660 1600,900 0,900" fill={`url(#${id("floor")})`} />
      <g stroke="#6E4E31" strokeWidth="2" opacity=".28">
        {boards.map((index) => { const x = 270 + index * (1060 / 12); const bottom = (x - 800) * (1600 / 1060) + 800; return <line key={index} x1={x} y1="660" x2={bottom} y2="900" />; })}
      </g>

      {/* window wall with a golden-hour view */}
      <rect x="360" y="170" width="880" height="452" fill="#2A2B2E" />
      <rect x="370" y="180" width="860" height="432" fill={`url(#${id("view")})`} />
      <path d="M370 470 C520 446 640 460 760 452 C900 442 1040 456 1230 448 L1230 612 L370 612 Z" fill="#6F7C61" opacity=".85" />
      <path d="M370 520 C560 500 760 520 1230 500 L1230 612 L370 612 Z" fill="#59654E" />
      <ellipse cx="980" cy="430" rx="120" ry="90" fill="#FFE4B4" opacity=".7" filter={`url(#${id("glow")})`} />
      <g fill="#2A2B2E">
        <rect x="652" y="180" width="8" height="432" />
        <rect x="940" y="180" width="8" height="432" />
      </g>

      {/* sunlight falling across the floor */}
      <polygon points="430,660 1180,660 1360,900 260,900" fill="#FFE1AE" opacity=".22" filter={`url(#${id("blur")})`} />

      {/* rug, sofa, table */}
      <polygon points="430,700 1170,700 1330,860 270,860" fill="#E9E2D5" opacity=".92" />
      <polygon points="430,700 1170,700 1176,706 424,706" fill="#D8CFC0" opacity=".9" />
      <ellipse cx="800" cy="666" rx="360" ry="14" fill="#5A4330" opacity=".32" filter={`url(#${id("blurS")})`} />
      <rect x="470" y="560" width="660" height="66" rx="26" fill={`url(#${id("sofa")})`} />
      <rect x="452" y="604" width="696" height="56" rx="24" fill="#CFC6B7" />
      <rect x="452" y="604" width="696" height="12" rx="6" fill="#DDD5C8" />
      <rect x="520" y="574" width="96" height="44" rx="14" fill="#B79C7A" />
      <rect x="984" y="574" width="96" height="44" rx="14" fill="#E9E2D6" />
      <ellipse cx="800" cy="790" rx="190" ry="26" fill="#3E2D1F" opacity=".22" filter={`url(#${id("blurS")})`} />
      <rect x="640" y="742" width="320" height="30" rx="4" fill="#C9BBA3" />
      <ellipse cx="800" cy="772" rx="160" ry="20" fill="#B8A78D" />
      <rect x="640" y="742" width="320" height="30" fill="#C9BBA3" />
      <ellipse cx="800" cy="742" rx="160" ry="28" fill={`url(#${id("stone")})`} />
      <path d="M752 736 C746 714 758 694 766 690 C774 694 786 714 780 736 Z" fill="#F1ECE3" />
      <path d="M766 690 C770 660 780 640 796 622 M768 676 C756 662 750 650 748 640" stroke="#6B5A44" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <rect x="822" y="726" width="74" height="12" rx="2" fill="#2F3532" opacity=".85" />
      <rect x="826" y="716" width="64" height="10" rx="2" fill="#B07A4C" opacity=".9" />

      {/* arc lamp */}
      <path d="M318 840 C318 520 430 330 610 320" stroke="#1E1F22" strokeWidth="7" fill="none" strokeLinecap="round" />
      <ellipse cx="318" cy="846" rx="40" ry="10" fill="#1E1F22" />
      <path d="M574 316 C574 290 646 290 646 316 Z" fill="#1E1F22" />
      <ellipse cx="610" cy="330" rx="60" ry="40" fill="#FFE1A8" opacity=".55" filter={`url(#${id("glow")})`} />

      {/* olive tree */}
      <rect x="1214" y="652" width="110" height="120" rx="18" fill="#D8CDBB" />
      <path d="M1268 652 C1262 600 1276 560 1262 520" stroke="#5A4A38" strokeWidth="7" fill="none" />
      <g fill="#6F7A55">
        <ellipse cx="1238" cy="470" rx="70" ry="54" />
        <ellipse cx="1300" cy="430" rx="74" ry="60" />
        <ellipse cx="1290" cy="510" rx="64" ry="46" />
      </g>
      <g fill="#87926A" opacity=".8">
        <ellipse cx="1268" cy="452" rx="44" ry="30" />
        <ellipse cx="1316" cy="404" rx="36" ry="26" />
      </g>

      <rect width="1600" height="900" fill={`url(#${id("vignette")})`} />
      <rect width="1600" height="900" filter={`url(#${id("grain")})`} />
    </svg>
  );
}

export function SceneKitchen({ uid }: SceneProps) {
  const id = (name: string) => `${name}-${uid}`;
  const pendants = [620, 800, 980];
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id("wall")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EAE5DC" />
          <stop offset="1" stopColor="#DCD4C7" />
        </linearGradient>
        <linearGradient id={id("cab")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2C333B" />
          <stop offset="1" stopColor="#1E242B" />
        </linearGradient>
        <linearGradient id={id("floor")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#CFC6B8" />
          <stop offset="1" stopColor="#A89D8C" />
        </linearGradient>
        <linearGradient id={id("marble")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F5F2EC" />
          <stop offset="1" stopColor="#E2DDD4" />
        </linearGradient>
        <linearGradient id={id("view")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B9C9D3" />
          <stop offset=".7" stopColor="#E9D7B9" />
          <stop offset="1" stopColor="#8E9A7E" />
        </linearGradient>
        <radialGradient id={id("vignette")} cx="50%" cy="50%" r="75%">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#1A1712" stopOpacity=".45" />
        </radialGradient>
        <filter id={id("glow")} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="26" /></filter>
        <filter id={id("blurS")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
        {grainFilter(id("grain"))}
      </defs>

      <rect width="1600" height="900" fill={`url(#${id("wall")})`} />
      <polygon points="0,0 1600,0 1440,90 160,90" fill="#F1EDE6" />
      <polygon points="160,660 1440,660 1600,900 0,900" fill={`url(#${id("floor")})`} />

      {/* tall cabinetry */}
      <rect x="160" y="90" width="420" height="570" fill={`url(#${id("cab")})`} />
      <rect x="1020" y="90" width="420" height="570" fill={`url(#${id("cab")})`} />
      <g stroke="#3A424B" strokeWidth="3">
        <line x1="300" y1="90" x2="300" y2="660" /><line x1="440" y1="90" x2="440" y2="660" />
        <line x1="1160" y1="90" x2="1160" y2="660" /><line x1="1300" y1="90" x2="1300" y2="660" />
      </g>
      <g fill="#8C7B62">
        <rect x="290" y="330" width="4" height="70" rx="2" /><rect x="430" y="330" width="4" height="70" rx="2" />
        <rect x="1170" y="330" width="4" height="70" rx="2" /><rect x="1310" y="330" width="4" height="70" rx="2" />
      </g>

      {/* window band and counter */}
      <rect x="580" y="250" width="440" height="200" fill="#2C333B" />
      <rect x="590" y="260" width="420" height="180" fill={`url(#${id("view")})`} />
      <path d="M590 380 C700 360 860 372 1010 360 L1010 440 L590 440 Z" fill="#76825F" />
      <rect x="580" y="450" width="440" height="14" fill="#E9E4DB" />
      <rect x="580" y="464" width="440" height="196" fill="#E2DCD2" />
      <g fill="#CBBFAE"><rect x="640" y="410" width="44" height="40" rx="6" /><circle cx="940" cy="430" r="20" /></g>

      {/* pendants */}
      {pendants.map((x) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2="300" stroke="#1C1F23" strokeWidth="2" />
          <circle cx={x} cy="320" r="70" fill="#FFD9A0" opacity=".45" filter={`url(#${id("glow")})`} />
          <circle cx={x} cy="318" r="22" fill="#FFE7BF" />
          <path d={`M${x - 26} 312 a26 26 0 0 1 52 0 Z`} fill="#1C1F23" />
        </g>
      ))}

      {/* island */}
      <ellipse cx="800" cy="842" rx="470" ry="30" fill="#3A332A" opacity=".35" filter={`url(#${id("blurS")})`} />
      <rect x="360" y="588" width="880" height="26" fill={`url(#${id("marble")})`} />
      <rect x="380" y="614" width="840" height="220" fill="#ECE7DF" />
      <rect x="360" y="588" width="26" height="246" fill="#F2EEE7" />
      <rect x="1214" y="588" width="26" height="246" fill="#DCD6CC" />
      <g stroke="#CFC7BA" strokeWidth="2" fill="none" opacity=".8">
        <path d="M420 640 C520 690 560 650 680 720 S880 760 960 800" />
        <path d="M760 620 C820 660 900 640 980 700 S1120 760 1180 740" />
      </g>
      <g fill="#E7CF97"><ellipse cx="700" cy="586" rx="38" ry="8" /><circle cx="690" cy="576" r="9" /><circle cx="708" cy="574" r="9" /><circle cx="700" cy="566" r="8" /></g>

      {/* stools */}
      {[520, 800, 1080].map((x) => (
        <g key={x}>
          <rect x={x - 50} y="680" width="100" height="22" rx="11" fill="#9A7653" />
          <rect x={x - 40} y="702" width="6" height="170" fill="#1F2226" />
          <rect x={x + 34} y="702" width="6" height="170" fill="#1F2226" />
          <rect x={x - 40} y="800" width="80" height="5" fill="#1F2226" />
        </g>
      ))}

      <rect width="1600" height="900" fill={`url(#${id("vignette")})`} />
      <rect width="1600" height="900" filter={`url(#${id("grain")})`} />
    </svg>
  );
}

export const sceneLibrary = [
  { key: "exterior", label: "Exterior · Dusk", Scene: SceneExterior, move: "push" },
  { key: "living", label: "Living room", Scene: SceneLiving, move: "pan" },
  { key: "kitchen", label: "Kitchen", Scene: SceneKitchen, move: "pull" },
] as const;
