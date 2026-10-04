# Generates the Light / Heavy infantry card illustrations (greyscale; tinted per faction in CSS).
# Usage: python3 packages/client/tools/gen-infantry.py packages/client/public/art/infantry
import random, sys
W, H = 500, 700

def f(x): return f"{x:.1f}"

def light_man(s, lean):
    """Spearman in leathers, base at (0,0), height ~ s. Returns body paths and spear paths."""
    p = []
    hx = 0
    # legs (slight stride)
    p.append(f"M{f(-.075*s)} {f(-.46*s)} L{f(-.085*s)} 0 L{f(-.035*s)} 0 L{f(-.01*s)} {f(-.4*s)} L{f(.02*s)} 0 L{f(.07*s)} 0 L{f(.07*s)} {f(-.46*s)} Z")
    # tunic skirt + torso (leather jerkin)
    p.append(f"M{f(-.1*s)} {f(-.4*s)} L{f(-.085*s)} {f(-.6*s)} L{f(-.1*s)} {f(-.82*s)} Q0 {f(-.86*s)} {f(.1*s)} {f(-.82*s)} L{f(.085*s)} {f(-.6*s)} L{f(.1*s)} {f(-.4*s)} Z")
    # arms reaching forward to the spear
    p.append(f"M{f(.07*s)} {f(-.8*s)} L{f(.17*s)} {f(-.66*s)} L{f(.15*s)} {f(-.62*s)} L{f(.05*s)} {f(-.72*s)} Z")
    p.append(f"M{f(-.08*s)} {f(-.79*s)} L{f(.04*s)} {f(-.56*s)} L{f(.075*s)} {f(-.58*s)} L{f(-.04*s)} {f(-.8*s)} Z")
    # neck, head, leather cap with a peak
    p.append(f"M{f(-.025*s)} {f(-.86*s)} h{f(.05*s)} v{f(-.04*s)} h{f(-.05*s)} Z")
    p.append(f"M{f(-.055*s)} {f(-.93*s)} a{f(.055*s)} {f(.06*s)} 0 1 0 {f(.11*s)} 0 a{f(.055*s)} {f(.06*s)} 0 1 0 {f(-.11*s)} 0 Z")
    p.append(f"M{f(-.065*s)} {f(-.94*s)} Q{f(-.06*s)} {f(-1.02*s)} {f(.005*s)} {f(-1.02*s)} Q{f(.07*s)} {f(-1.01*s)} {f(.09*s)} {f(-.95*s)} L{f(.12*s)} {f(-.94*s)} Z")
    # spear: long, raised forward at an angle
    sx0, sy0 = -.06*s, -.18*s
    sx1, sy1 = (.06+lean)*s, -1.55*s
    spear = (sx0, sy0, sx1, sy1)
    return p, spear

def heavy_man(s):
    """Plate soldier behind a tower shield, base at (0,0)."""
    p = []
    # legs (greaves)
    p.append(f"M{f(-.1*s)} {f(-.3*s)} L{f(-.1*s)} 0 L{f(-.03*s)} 0 L{f(-.02*s)} {f(-.3*s)} Z")
    p.append(f"M{f(.02*s)} {f(-.3*s)} L{f(.03*s)} 0 L{f(.1*s)} 0 L{f(.1*s)} {f(-.3*s)} Z")
    # broad torso with pauldrons
    p.append(f"M{f(-.13*s)} {f(-.32*s)} L{f(-.14*s)} {f(-.72*s)} Q{f(-.2*s)} {f(-.8*s)} {f(-.12*s)} {f(-.84*s)} L{f(.12*s)} {f(-.84*s)} Q{f(.2*s)} {f(-.8*s)} {f(.14*s)} {f(-.72*s)} L{f(.13*s)} {f(-.32*s)} Z")
    # gorget + helm: domed with a brim and a ridge crest
    p.append(f"M{f(-.04*s)} {f(-.84*s)} h{f(.08*s)} v{f(-.05*s)} h{f(-.08*s)} Z")
    p.append(f"M{f(-.085*s)} {f(-.9*s)} L{f(-.075*s)} {f(-.97*s)} Q0 {f(-1.1*s)} {f(.075*s)} {f(-.97*s)} L{f(.085*s)} {f(-.9*s)} L{f(.11*s)} {f(-.885*s)} L{f(-.11*s)} {f(-.885*s)} Z")
    p.append(f"M{f(-.012*s)} {f(-1.04*s)} Q0 {f(-1.13*s)} {f(.05*s)} {f(-1.1*s)} L{f(.012*s)} {f(-1.035*s)} Z")
    shield = f"M{f(-.17*s)} {f(-.78*s)} Q0 {f(-.83*s)} {f(.17*s)} {f(-.78*s)} L{f(.165*s)} {f(-.2*s)} Q0 {f(-.12*s)} {f(-.165*s)} {f(-.2*s)} Z"
    boss = (0, -.5*s, .045*s)
    return p, shield, boss

def row(kind, n, y, s, x0, x1, body, rim, rnd, rim_w, detail):
    out = []
    xs = [x0 + (x1-x0)*i/(n-1) + rnd.uniform(-.06,.06)*s for i in range(n)] if n > 1 else [(x0+x1)/2]
    for i, x in enumerate(xs):
        ss = s * rnd.uniform(.94, 1.05)
        yy = y + rnd.uniform(-.02, .02)*s
        g = []
        if kind == 'light':
            parts, (a,b,c,d) = light_man(ss, rnd.uniform(.12,.3))
            spear = f'<path d="M{f(a)} {f(b)} L{f(c)} {f(d)}" stroke-width="{f(max(2.2,.02*ss))}" stroke-linecap="round" fill="none"/>'
            tip = f'<path d="M{f(c)} {f(d)} l{f(-.022*ss)} {f(.09*ss)} l{f(.03*ss)} {f(-.005*ss)} Z" transform="rotate(0)"/>'
            body_d = "".join(f'<path d="{d}" stroke="none"/>' for d in parts)
            if rim:
                g.append(f'<g transform="translate({f(rim_w)} {f(-rim_w*.7)})" fill="{rim}" stroke="{rim}">{body_d}{spear}{tip}</g>')
            g.append(f'<g fill="{body}" stroke="{body}">{body_d}{spear}{tip}</g>')
            if detail:  # belt, shoulder strap, lit cheek
                g.append(f'<path d="M{f(-.09*ss)} {f(-.6*ss)} h{f(.18*ss)} v{f(.025*ss)} h{f(-.18*ss)} Z M{f(-.08*ss)} {f(-.8*ss)} L{f(.08*ss)} {f(-.62*ss)} L{f(.09*ss)} {f(-.64*ss)} L{f(-.06*ss)} {f(-.82*ss)} Z" fill="#000" fill-opacity=".35"/>')
        else:
            parts, shield, (bx,by,br) = heavy_man(ss)
            body_d = "".join(f'<path d="{d}" stroke="none"/>' for d in parts)
            pike = ''
            if detail != 'front':
                pike = f'<path d="M{f(.12*ss)} {f(-.25*ss)} L{f(.12*ss)} {f(-1.45*ss)}" stroke-width="{f(max(2,.018*ss))}" fill="none"/><path d="M{f(.12*ss)} {f(-1.55*ss)} l{f(-.02*ss)} {f(.08*ss)} h{f(.04*ss)} Z"/>'
            if rim:
                g.append(f'<g transform="translate({f(rim_w)} {f(-rim_w*.7)})" fill="{rim}" stroke="{rim}">{body_d}<path d="{shield}"/>{pike}</g>')
            g.append(f'<g fill="{body}" stroke="{body}">{body_d}{pike}</g>')
            # shield face: slightly lighter than the body with a dark rim and boss
            g.append(f'<path d="{shield}" fill="url(#shield)" stroke="#000" stroke-opacity=".55" stroke-width="{f(max(1,.012*ss))}"/>')
            g.append(f'<circle cx="{f(bx)}" cy="{f(by)}" r="{f(br)}" fill="{body}" stroke="#000" stroke-opacity=".4" stroke-width="{f(max(.8,.008*ss))}"/>')
            if detail:
                g.append(f'<path d="M{f(-.14*ss)} {f(-.5*ss)} h{f(.28*ss)}" stroke="#000" stroke-opacity=".3" stroke-width="{f(max(1,.01*ss))}"/>')
        out.append(f'<g transform="translate({f(x)} {f(yy)})">{"".join(g)}</g>')
    return "\n".join(out)

def svg(kind):
    rnd = random.Random(7 if kind == 'light' else 13)
    label = 'Light infantry' if kind == 'light' else 'Heavy infantry'
    rows = []
    if kind == 'light':
        rows.append(row(kind, 10, 470, 120, 40, 470, '#5d6268', None, rnd, 0, None))
        rows.append(row(kind, 6, 585, 205, 50, 470, '#2e3136', '#7d8288', rnd, 2.0, 'mid'))
        rows.append(row(kind, 3, 790, 400, 90, 440, '#111215', '#a2a7ad', rnd, 3.0, 'front'))
    else:
        rows.append(row(kind, 9, 470, 115, 40, 470, '#5d6268', None, rnd, 0, None))
        rows.append(row(kind, 5, 590, 200, 55, 455, '#2e3136', '#7d8288', rnd, 2.0, 'mid'))
        rows.append(row(kind, 3, 800, 390, 70, 430, '#111215', '#a2a7ad', rnd, 3.0, 'front'))
    back, mid, front = rows
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="{label}">
  <!-- Generated: three ranks receding into a storm haze, rim-lit from the upper right, feet lost in
       ground fog. Greyscale on purpose: the card tints it with its faction colour. -->
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16191d"/>
      <stop offset="0.42" stop-color="#2c3035"/>
      <stop offset="0.64" stop-color="#6f747a"/>
      <stop offset="0.72" stop-color="#4a4e54"/>
      <stop offset="1" stop-color="#1b1d21"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.66" cy="0.63" r="0.55" gradientTransform="translate(0.33 0.31) scale(1 0.5) translate(-0.33 -0.31)">
      <stop offset="0" stop-color="#c3c7cc" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#c3c7cc" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9ba0a6" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#9ba0a6" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#9ba0a6" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#08090b" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#08090b" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#08090b" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="shield" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2a2d32"/>
      <stop offset="0.7" stop-color="#3b3f45"/>
      <stop offset="1" stop-color="#6c7178"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#sky)"/>
  <rect width="{W}" height="{H}" fill="url(#glow)"/>
  <g>{back}</g>
  <rect y="430" width="{W}" height="110" fill="url(#mist)"/>
  <g>{mid}</g>
  <rect y="520" width="{W}" height="180" fill="url(#fog)" opacity="0.55"/>
  <g>{front}</g>
  <rect y="560" width="{W}" height="140" fill="url(#fog)"/>
</svg>
'''

out = sys.argv[1]
for k in ('light', 'heavy'):
    open(f'{out}/{k}.svg', 'w').write(svg(k))
print('ok')
