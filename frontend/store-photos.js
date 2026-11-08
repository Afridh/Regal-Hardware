/* Product photos the shop has (Kevilton, Orange, S-lon fittings, the paint makers' tins), matched to the till's products by
   their code or what their name says. Taken out of shop.html so the new front page (store.html) uses the same matching. */
(function () {
const catKey = (n) => String(n || '').toUpperCase().replace(/\s+/g, ' ').trim();
const PRODUCT_PHOTOS = {
  'PCT-11-001762': 'chrome-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE - MODULAR BLACK
  'PCT-11-001763': 'chrome-light-dimmer.jpg',   // KEVILTON LIGHT DIMMER - MODULAR BLACK
  'PCT-11-001764': 'chrome-fan-controler.jpg',   // KEVILTON MOD BLACK FAN CONTROLER
  'PCT-11-001765': 'chrome-telephone-socket.jpg',   // KEVILTON TELEPHONE SOCKET - MODULAR BLACK
  'PCT-11-001766': 'chrome-tv-socket.jpg',   // KEVILTON TV SOCKET - MODULAR BLACK
  'PCT-11-001767': 'chrome-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE - MODULAR BLACK
  'PCT-11-001768': 'chrome-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY - MODULAR BLACK
  'PCT-11-001769': 'chrome-2-gang-2-way.jpg',   // KEVILTON 2G 2WAY - MODULAR BLACK
  'PCT-11-001770': 'chrome-3-gang-2-way.jpg',   // KEVILTON 3G 2WAY - MODULAR BLACK
  'PCT-11-001771': 'chrome-4-gang-2-way.jpg',   // KEVILTON 4G 2WAY - MODULAR BLACK
  'PCT-11-001780': 'ivory-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY - MODULAR WHITE
  'PCT-11-001781': 'ivory-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY - MODULAR WHITE
  'PCT-11-001782': 'ivory-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY - MODULAR WHITE
  'PCT-11-001783': 'ivory-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY - MODULAR WHITE
  'PCT-11-001784': 'ivory-bell-press.jpg',   // KEVILTON BELL PRESS - MODULAR WHITE
  'PCT-11-001785': 'ivory-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE - MODULAR WHITE
  'PCT-11-001786': 'ivory-blank-plate.jpg',   // KEVILTON BLANK PLATE - MODULAR WHITE
  'PCT-11-001787': 'ivory-fan-controler.jpg',   // KEVILTON FAN CONTROLLER MODULAR WHITE
  'PCT-11-001788': 'ivory-light-dimmer.jpg',   // KEVILTON LIGHT DIMMER - MODULAR WHITE
  'PCT-11-001789': 'ivory-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON - MODULAR WHITE
  'PCT-11-001790': 'ivory-telephone-socket.jpg',   // KEVILTON TELEPHONE SOCKET - MODULAR WHITE
  'PCT-11-001791': 'ivory-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE - MODULAR WHITE
  'PCT-11-001792': 'ivory-2-gang-2-way.jpg',   // KEVILTON 2G 2WAY - MODULAR WHITE
  'PCT-11-001793': 'ivory-3-gang-2-way.jpg',   // KEVILTON 3G 2WAY - MODULAR WHITE
  'PCT-11-001794': 'ivory-4-gang-2-way.jpg',   // KEVILTON 4G 2WAY - MODULAR WHITE
  'PCT-11-001796': 'mahogany-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY - MAHOGANY
  'PCT-11-001867': 'sunk-boxes-twin-sunk-box.jpg',   // TWIN SUN BOX KEVILTON
  'PCT-11-001564': 'sunk-boxes-twin-sunk-box.jpg',   // DOUBLE SUNK BOX - KEVILTON
  'PCT-11-001872': 'rccbs-rccb-10ka-2-pole.jpg',   // TRIP SWITCH - KEVILTON - PRIME
  'PCT-11-001511': 'mahogany-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY - MAHOGANY
  'PCT-11-001513': 'mahogany-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY - MAHOGANY
  'PCT-11-001514': 'mahogany-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY - MAHOGANY
  'PCT-11-001515': 'mahogany-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE - MAHOGANY
  'PCT-11-001517': 'mahogany-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE - MAHOGANY
  'PCT-11-001518': 'mahogany-blank-plate.jpg',   // KEVILTON BLANK PLATE - MAHOGANY
  'PCT-11-001519': 'mahogany-2-gang-2-way.jpg',   // KEVILTON 2G 2WAY - MAHOGANY
  'PCT-11-001561': 'lamp-holders-straight-batten-holder.jpg',   // BATTEN HOLDER KEVILTON
  'PCT-11-001562': 'lamp-holders-angle-batten-holder.jpg',   // ANGL HOLDER KEVILTON
  'PCT-11-001563': 'sunk-boxes-single-sunk-box.jpg',   // SINGLE SUN BOX KEVILTON
  'PCT-11-001565': 'sunk-boxes-3-way-sunk-box.jpg',   // 3WAY SUN BOX KEVILTON
  'PCT-11-001566': 'sunk-boxes-4-way-sunk-box.jpg',   // 4 WAY SUN BOX KEVILTON
  'PCT-11-001567': 'junction-box.jpg',   // JUNCTION BOX KEVILTON
  'PCT-11-001569': 'busbar.jpg',   // BUS BAR KEVILTON
  'PCT-11-001570': 'earth-rods-earth-rod-12-mm-x-1500-mm.jpg',   // EARTH ROD - KEVILTON
  'PCT-11-001572': 'isolators-isolator-10ka-2-pole.jpg',   // MAIN SWITCH KEVILTON HEXA
  'PCT-11-001573': 'mcbs-mcb-10ka-1-pole.jpg',   // 6AMP BREAKER KEVILTON HEXA
  'PCT-11-001574': 'mcbs-mcb-10ka-1-pole.jpg',   // 10AMP BREAKER KEVILTON HEXA
  'PCT-11-001575': 'mcbs-mcb-10ka-1-pole.jpg',   // 16AMP BREAKER KEVILTON HEXA
  'PCT-11-001576': 'mcbs-mcb-10ka-1-pole.jpg',   // 20AMP BREAKER KEVILTON HEXA
  'PCT-11-001577': 'mcbs-mcb-10ka-1-pole.jpg',   // 32AMP BREAKER KEVILTON HEXA
  'PCT-11-001578': 'mcbs-mcb-10ka-1-pole.jpg',   // KEVILTON 6AMP BREAKER - PRIME
  'PCT-11-001579': 'mcbs-mcb-10ka-1-pole.jpg',   // 10AMP BREAKER KEVILTON PRIME
  'PCT-11-001580': 'mcbs-mcb-10ka-1-pole.jpg',   // KEVILTON 16AMP BREAKER - PRIME
  'PCT-11-001581': 'mcbs-mcb-10ka-1-pole.jpg',   // 20AMP BREAKER - KEVILTON - PRIME
  'PCT-11-001582': 'mcbs-mcb-10ka-1-pole.jpg',   // 32AMP BREAKER - KEVILTON - PRIME
  'PCT-11-001584': 'isolators-isolator-10ka-2-pole.jpg',   // PRIME MAIN SWITCH KEVILTON
  'PCT-11-001521': 'mahogany-3-gang-2-way.jpg',   // KEVILTON 3G 2WAY - MAHOGANY
  'PCT-11-001522': 'mahogany-4-gang-2-way.jpg',   // KEVILTON 4G 2WAY - MAHOGANY
  'PCT-11-001523': 'mahogany-hum-free-fan-controler.jpg',   // KEVILTON 5 STEP HUM FREE - MAHOGANY
  'PCT-11-001813': 'mahogany-hum-free-fan-controler.jpg',   // HUMFREE FAN CONTROLLER - KEVILTON - MAHOGANY
  'PCT-11-001524': 'mahogany-light-dimmer.jpg',   // KEVILTON LIGHT DIMMER - MAHOGANY
  'PCT-11-001525': 'mahogany-tv-socket.jpg',   // KEVILTON TV SOCKET - MAHOGANY
  'PCT-11-001745': 'white-light-dimmer-with-1-gang.jpg',   // KEVILTON LIGHT DIMMER
  'PCT-11-001746': 'white-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY
  'PCT-11-001747': 'white-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY
  'PCT-11-001748': 'white-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY
  'PCT-11-001749': 'white-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY
  'PCT-11-001750': 'white-5-gang-1-way.jpg',   // KEVILTON 5G 1WAY
  'PCT-11-001883': 'plug-tops-plug-top-13a.jpg',   // 13AMP PLUG TOP KEVILTON
  'PCT-11-001751': 'white-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE
  'PCT-11-001753': 'white-bell-press.jpg',   // KEVILTON BELL PRESS
  'PCT-11-001755': 'white-blank-plate.jpg',   // KEVILTON BLANK PLATE
  'PCT-11-001756': 'white-fan-controller-with-1-gang.jpg',   // KEVILTON FAN CONTROLER
  'PCT-11-001757': 'chrome-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY - MODULAR BLACK
  'PCT-11-001758': 'chrome-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY - MODULAR BLACK
  'PCT-11-001759': 'chrome-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY - MODULAR BLACK
  'PCT-11-001760': 'chrome-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY - MODULAR BLACK
  'PCT-11-001761': 'chrome-bell-press.jpg',   // KEVILTON BELL PRESS - MODULAR BLACK
  'PCT-11-002987': 'mahogany-telephone-socket.jpg',   // KEVILTON TELEPHONE SOCKET - MAHOGANY
  'PCT-11-003029': 'ivory-tv-socket.jpg',   // KEVILTON TV SOCKET - MODULAR WHITE
  'PCT-12-003159': 'plastic-enclosures-sunk.jpg',   // KEVILTON ABC BOX 15 WAY SUNK
  'PCT-12-003164': 'ivory-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY - MODULAR WHITE
  'PCT-11-003180': 'white-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE
  'PCT-12-003200': 'mahogany-bell-press.jpg',   // KEVILTON BELL PRESS - MAHOGANY
  'PCT-12-003307': 'led-indicator.jpg',   // KEVILTON LED INDICATOR-GREEN
  'PCT-12-003308': 'white-hum-free-fan-controller-5-step.jpg',   // KEVILTON 5 STEP HUM FREE
  'PCT-12-003309': 'white-tv-socket.jpg',   // KEVILTON TV SOCKET
  'PCT-11-004709': 'white-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON
  'PCT-11-004710': 'white-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY
  'PCT-11-004712': 'white-tumbler-switch.jpg',   // KEVILTON TUMBLER SWITCH
  'PCT-11-004713': 'ivory-hum-free-fan-controler.jpg',   // KEVILTON 5 STEP HUM FREE - MODULAR WHITE
  'PCT-11-004720': 'chrome-blank-plate.jpg',   // KEVILTON BLANK PLATE - MODULAR BLACK
  'PCT-11-004721': 'chrome-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON - MODULAR BLACK
  'PCT-11-004725': 'chrome-hum-free-fan-controler.jpg',   // KEVILTON 5 STEP HUM FREE - MODULAR BLACK
  'PCT-11-004736': 'mahogany-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON - MAHOGANY
  'PCT-13-005064': 'mahogany-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY - MAHOGANY
  'PCT-11-005065': 'teak-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY - TEAK
  'PCT-11-005066': 'teak-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY - TEAK
  'PCT-11-005067': 'teak-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY - TEAK
  'PCT-11-005068': 'teak-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY - TEAK
  'PCT-11-005069': 'teak-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE - TEAK
  'PCT-11-005071': 'teak-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON - TEAK
  'PCT-11-005072': 'teak-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE - TEAK
  'PCT-11-005073': 'teak-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY - TEAK
  'PCT-11-005074': 'teak-2-gang-2-way.jpg',   // KEVILTON 2G 2WAY - TEAK
  'PCT-11-005075': 'teak-3-gang-2-way.jpg',   // KEVILTON 3G 2WAY SWITCH - TEAK
  'PCT-11-005076': 'teak-4-gang-2-way.jpg',   // KEVILTON 4G 2WAY - TEAK
  'PCT-11-005077': 'teak-light-dimmer.jpg',   // KEVILTON LIGHT DIMMER - TEAK
  'PCT-11-005078': 'teak-hum-free-fan-controler.jpg',   // KEVILTON 5 STEP HUM FREE - TEAK
  'PCT-11-005079': 'teak-tv-socket.jpg',   // KEVILTON TV SOCKET - TEAK
  'PCT-11-005080': 'teak-telephone-socket.jpg',   // KEVILTON TELEPHONE SOCKET - TEAK
  'PCT-11-005081': 'teak-bell-press.jpg',   // KEVILTON BELL PRESS - TEAK
  'PCT-11-005099': 'chrome-data-socket.jpg',   // KEVILTON CAT 6 DATA SOCKET - MODULAR BLACK
  'PCT-13-005115': 'kumbuk-1-gang-1-way.jpg',   // KEVILTON 1G 1WAY - KUMBUK
  'PCT-13-005116': 'kumbuk-2-gang-1-way.jpg',   // KEVILTON 2G 1WAY - KUMBUK
  'PCT-13-005117': 'kumbuk-3-gang-1-way.jpg',   // KEVILTON 3G 1WAY - KUMBUK
  'PCT-13-005118': 'kumbuk-4-gang-1-way.jpg',   // KEVILTON 4G 1WAY - KUMBUK
  'PCT-13-005119': 'kumbuk-13a-socket.jpg',   // KEVILTON 13AMP PLUG BASE - KUMBUK
  'PCT-13-005120': 'kumbuk-blank-plate.jpg',   // KEVILTON BLANK PLATE - KUMBUK
  'PCT-13-005121': 'kumbuk-13a-socket-with-neon.jpg',   // KEVILTON 13AMP PLUG BASE NEON - KUMBUK
  'PCT-13-005122': 'kumbuk-20a-double-pole-with-neon.jpg',   // KEVILTON 20AMP D/POLE - KUMBUK
  'PCT-13-005123': 'kumbuk-1-gang-2-way.jpg',   // KEVILTON 1G 2WAY - KUMBUK
  'PCT-13-005124': 'kumbuk-2-gang-2-way.jpg',   // KEVILTON 2G 2WAY - KUMBUK
  'PCT-13-005125': 'kumbuk-3-gang-2-way.jpg',   // KEVILTON 3G 2WAY - KUMBUK
  'PCT-13-005126': 'kumbuk-4-gang-2-way.jpg',   // KEVILTON 4G 2WAY - KUMBUK
  'PCT-13-005127': 'kumbuk-light-dimmer.jpg',   // KEVILTON LIGHT DIMMER - KUMBUK
  'PCT-13-005128': 'kumbuk-hum-free-fan-controler.jpg',   // KEVILTON 5 STEP HUM FREE - KUMBUK
  'PCT-13-005129': 'kumbuk-tv-socket.jpg',   // KEVILTON TV SOCKET - KUMBUK
  'PCT-13-005130': 'kumbuk-telephone-socket.jpg',   // KEVILTON TELEPHONE SOCKET - KUMBUK
  'PCT-13-005131': 'kumbuk-bell-press.jpg',   // KEVILTON BELL PRESS - KUMBUK
  'PCT-11-005288': 'mahogany-data-socket.jpg',   // KEVILTON DATA SOCKET CAT 5 - MAHOGANY
  'PCT-11-005786': 'ceiling-rose.jpg',   // CEALING ROSE KEVILTON
  'PCT-11-006781': 'plastic-enclosures-sunk.jpg',   // KEVILTON 12WAY ABC BOX SUNK
  'PCT-11-006782': 'plastic-enclosures-surface.jpg',   // KEVILTON 12WAY ABC BOX SURFACE
  'PCT-11-006783': 'plastic-enclosures-sunk.jpg',   // KEVILTON 15WAY ABC BOX SUNK
  'PCT-11-006784': 'plastic-enclosures-surface.jpg',   // KEVILTON 15WAY ABC BOX SURFACE
  'PCT-11-006785': 'plastic-enclosures-surface.jpg',   // KEVILTON 18WAY ABC BOX SURFACE
  'PCT-11-006786': 'plastic-enclosures-sunk.jpg',   // KEVILTON 18WAY ABC BOX SUNK
  'PCT-11-006787': 'plastic-enclosures-sunk.jpg',   // KEVILTON 24WAY ABC BOX SUNK
  'PCT-11-006788': 'plastic-enclosures-surface.jpg',   // KEVILTON 24WAY ABC BOX SURFACE
  // Orange (Orel) — Casablanca range in White, Enigma in Classic White, from catalog.orel.com
  'PCT-11-001731': 'orange/casablanca-1gang-1way-switch.webp',   // ORANGE 1G 1W SWITCH
  'PCT-11-001732': 'orange/casablanca-2gang-1way-switch.webp',   // ORANGE 2G 1W SWITCH
  'PCT-11-001733': 'orange/casablanca-3gang-1way-switch.webp',   // ORANGE 3G 1W SWITCH
  'PCT-11-001734': 'orange/casablanca-4gang-1way-switch.webp',   // ORANGE 4G 1W SWITCH
  'PCT-11-001735': 'orange/casablanca-5gang-1way-switch.webp',   // ORANGE 5G 1W SWITCH
  'PCT-11-001741': 'orange/casablanca-1gang-2way-switch.webp',   // ORANGE 1G 2W SWITCH
  'PCT-11-001736': 'orange/casablanca-13amp-single-switched-socket-outlet.webp',   // ORANGE 13AMP PLUG BASE
  'PCT-11-001738': 'orange/casablanca-13amp-single-switched-socket-outlet-with-neon.webp',   // ORANGE 13AMP PLUG BASE -NEON
  'PCT-11-001737': 'orange/casablanca-1gang-4wire-telephone-outlet.webp',   // ORANGE TELEPHONE SOCKET
  'PCT-11-002984': 'orange/casablanca-1gang-tv-co-axial-outlet-75-ohm.webp',   // ORANGE TV SOCKET
  'PCT-11-001740': 'orange/casablanca-1gang-2way-bell-press-switch.webp',   // ORANGE BELL PRESS SWITCH
  'PCT-11-001742': 'orange/casablanca-90watt-5step-humfree-fan-controller.webp',   // ORANGE HUMFREE FAN CONTROLLER
  'PCT-11-002982': 'orange/casablanca-400watt-light-dimmer-controller-with-switch.webp',   // ORANGE LIGHT DIMER
  'PCT-11-001826': 'orange/casablanca-20amp-double-pole-switch.webp',   // ORANGE 20AMP D/P SOCKET
  'PCT-11-001743': 'orange/casablanca-20amp-double-pole-switch-with-neon.webp',   // ORANGE D/POLE SWITCH WITH NEON
  'PCT-11-001744': 'orange/casablanca-1gang-blank-plate-with-removable-plug.webp',   // ORANGE BLANK PLATE
  'PCT-12-002927': 'orange/enigma-1gang-1way-switch.webp',   // ORANGE ENIGMA 1G 1WAY SWITCH
  'PCT-12-002928': 'orange/enigma-2gang-1way-switch.webp',   // ORANGE ENIGMA 2G 1WAY SWITCH
  'PCT-12-002929': 'orange/enigma-3gang-1way-switch.webp',   // ORANGE ENIGMA 3G 1WAY SWITCH
  'PCT-12-002930': 'orange/enigma-4gang-1way-switch.webp',   // ORANGE ENIGMA 4G 1WAY SWITCH
  'PCT-12-002931': 'orange/enigma-5gang-1way-switch.webp',   // ORANGE ENIGMA 5G 1WAY SWITCH
  'PCT-12-002932': 'orange/enigma-6gang-1way-switch.webp',   // ORANGE ENIGMA 6G 1WAY SWITCH
  'PCT-12-002934': 'orange/enigma-1gang-2way-switch.webp',   // ORANGE ENIGMA 1G 2WAY SWITCH
  'PCT-12-002935': 'orange/enigma-1gang-2way-bell-press-switch.webp',   // ORANGE ENIGMA BELL PRESS SWITCH
  'PCT-12-002936': 'orange/enigma-20amp-double-pole-switch-with-indicator.webp',   // ORANGE ENIGMA 20AMP D/POLE INDICATOR
  'PCT-12-002937': 'orange/enigma-400watt-light-dimmer-controller-with-switch.webp',   // ORANGE ENIGMA LIGHT DIMMER
  'PCT-12-002938': 'orange/enigma-400watt-fan-controller-with-switch.webp',   // ORANGE ENIGMA FAN CONTROLLER
  'PCT-11-002985': 'orange/enigma-400watt-fan-controller-with-switch.webp',   // ORANGE ENIGMA FAN SPEED CONTROLER
  'PCT-11-007451': 'orange/enigma-1gang-4wire-telephone-outlet.webp',   // ORANGE ENIGMA TELEPHONE SOCKET
  'PCT-11-007452': 'orange/enigma-1gang-tv-co-axial-outlet-75ohm.webp',   // ORANGE ENIGMA TV SOCKET
  // Enigma Gunmetal (added from orange-enigma-gunmetal.csv)
  'PCT-12-002933': 'orange/enigma-13amp-single-switched-socket-outlet.webp',   // ORANGE ENIGMA 13AMP PLUG BASE
  'PCT-12-007801': 'orange/enigma-1gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 1G 1WAY SWITCH - GUNMETAL
  'PCT-12-007802': 'orange/enigma-2gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 2G 1WAY SWITCH - GUNMETAL
  'PCT-12-007803': 'orange/enigma-3gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 3G 1WAY SWITCH - GUNMETAL
  'PCT-12-007804': 'orange/enigma-4gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 4G 1WAY SWITCH - GUNMETAL
  'PCT-12-007805': 'orange/enigma-5gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 5G 1WAY SWITCH - GUNMETAL
  'PCT-12-007806': 'orange/enigma-6gang-1way-switch-gunmetal.webp',   // ORANGE ENIGMA 6G 1WAY SWITCH - GUNMETAL
  'PCT-12-007807': 'orange/enigma-1gang-2way-switch-gunmetal.webp',   // ORANGE ENIGMA 1G 2WAY SWITCH - GUNMETAL
  'PCT-12-007808': 'orange/enigma-13amp-single-switched-socket-outlet-gunmetal.webp',   // ORANGE ENIGMA 13AMP PLUG BASE - GUNMETAL
  'PCT-12-007809': 'orange/enigma-1gang-2way-bell-press-switch-gunmetal.webp',   // ORANGE ENIGMA BELL PRESS SWITCH - GUNMETAL
  'PCT-12-007810': 'orange/enigma-20amp-double-pole-switch-with-indicator-gunmetal.webp',   // ORANGE ENIGMA 20AMP D/POLE INDICATOR - GUNMETAL
  'PCT-12-007811': 'orange/enigma-400watt-light-dimmer-controller-with-switch-gunmetal.webp',   // ORANGE ENIGMA LIGHT DIMMER - GUNMETAL
  'PCT-12-007812': 'orange/enigma-400watt-fan-controller-with-switch-gunmetal.webp',   // ORANGE ENIGMA FAN CONTROLLER - GUNMETAL
  'PCT-12-007813': 'orange/enigma-400watt-fan-controller-with-switch-gunmetal.webp',   // ORANGE ENIGMA FAN SPEED CONTROLER - GUNMETAL
  'PCT-12-007814': 'orange/enigma-1gang-4wire-telephone-outlet-gunmetal.webp',   // ORANGE ENIGMA TELEPHONE SOCKET - GUNMETAL
  'PCT-12-007815': 'orange/enigma-1gang-tv-co-axial-outlet-75ohm-gunmetal.webp',   // ORANGE ENIGMA TV SOCKET - GUNMETAL
};
/* S-lon's photos of its uPVC pressure fittings (from s-lon.lk), given to the PVC fittings (in the categories below) by what their
   name says they are. Drainage, door and 45° fittings, unions, gutters and pipes look different and
   keep the stand-in. First match wins, so the narrower kinds come first. */
const PVC_FITTINGS = new Set(['PVC ITEMS', 'R/T/SOCKET', 'R/SOCKET', 'V/SOCKET', 'F/SOCKET', 'ELBOW', 'BEND', 'END CAP', 'PVC C/SADDLE', 'CLIP PVC']);
const PVC_SKIP = /\bDN\b|DOOR|\bY\b|TRAP|COWL|GUTTER|\bDP\b|UNION|NIPPLE|THREAD|TREAD|PIPE|\b45\b/;
const PVC_PHOTOS = [
  [/BRASS.*FAUC?S?ET ELBOW|FAUC?S?ET ELBOW.*BRASS/, 'brass-faucet-elbow'], [/BRASS.*FAUC?S?ET SOCKET|FAUC?S?ET SOCKET.*BRASS/, 'brass-faucet-socket'],
  [/BRASS.*FAUC?S?ET TEE|FAUC?S?ET TEE.*BRASS/, 'brass-faucet-tee'],
  [/REDUCING FAUC?S?ET ELBOW/, 'reducing-faucet-elbow'], [/FAUC?S?ET ELBOW/, 'faucet-elbow'], [/FAUC?S?ET SOCKET/, 'faucet-socket'], [/FAUC?S?ET TEE/, 'faucet-tee'],
  [/VALVE SOCKET/, 'valve-socket'], [/REDUCING TEE|R\/TEE/, 'reducing-tee'], [/REDU[CS]ING SOCKET|\bR\/S(OCKET)?\b/, 'reducing-socket'],
  [/\bBEN[DT]\b/, 'bend-90'], [/\bELBOW\b/, 'elbow-90'], [/\bTEE\b/, 'equal-tee-90'],
  [/END ?C[AU]P|\bCAP\b|\bCUP\b/, 'cap'], [/CLIP|SADDLE/, 'saddle-clip'], [/SOCKET/, 'socket']];
const pvcPhoto = (p) => {
  if (!p || !PVC_FITTINGS.has(catKey(p.cat))) return '';
  const n = String(p.name || '').toUpperCase();
  if (PVC_SKIP.test(n)) return '';
  const hit = PVC_PHOTOS.find(([re]) => re.test(n));
  return hit ? '/img/products/slon/' + hit[1] + '.webp' : '';
};
/* The paint makers' own tin photos (Asian Paints Causeway, Nippon Paint Lanka and Dulux Sri Lanka sites), given by
   what the product's name says it is. One tin stands for every size and shade of its range; tinting bases,
   stainers and anything the makers don't show keep the stand-in. First match wins. */
const PAINT_PHOTOS = [
  [/\bASIAN\b.*\bKENLUX\b/, 'asian-kenlux'], [/\bASIAN\b.*\bANTI ?C[OR]R?OS/, 'asian-anticorrosive'], [/\bASIAN\b.*\bBRIGHT ALUMI/, 'asian-aluminium'],
  [/\bASIAN\b.*\bHAMMER FINI?SH/, 'asian-hammer-finish'], [/\bASIAN\b.*\bFLOOR PAINT/, 'asian-floor-paint'], [/\bASIAN\b.*\bAPEX SHIELD/, 'asian-apex-shield'],
  [/\bASIAN\b.*\bAPCOLITE/, 'asian-apcolite'], [/\bCHAMP INT/, 'asian-champ'], [/\bASIAN\b.*\bCLASSIQUE GLO/, 'asian-classique-glo'],
  [/\bASIAN\b.*\bAQUA SAFE/, 'asian-aqua-safe'], [/\bASIAN\b.*\bDAMP SEAL/, 'asian-damp-seal'], [/\bASIAN\b.*\bCR[EA]+K SEAL/, 'asian-crack-seal'],
  [/\bASIAN\b.*\bVITALIA/, 'asian-vitalia-neo'], [/\bASIAN\b.*\bREPAIR POLYMER/, 'asian-repair-polymer'], [/\bASIAN\b.*\bDAMP PROOF/, 'asian-damp-proof'],
  [/\bNIPPON\b.*\bWOOD ?CARE/, 'nippon-wood-care'], [/\bNIPPON\b.*\bBREEZE\b.*\bFLOOR/, 'nippon-floor-paint-wb'], [/\bNIPPON\b.*\bW\/B FLOOR/, 'nippon-floor-paint-wb'],
  [/\bNIPPON\b.*\bBREEZE EXT/, 'nippon-breeze-exterior'], [/\bNIPPON\b.*\bBREEZE INT/, 'nippon-breeze-interior'],
  [/\bNIPPON\b.*\bACRYLIC EXTERIOR FILLER/, 'nippon-exterior-filler'], [/\bNIPPON\b.*\bENAMEL\b/, 'nippon-enamel'],
  [/\bNIPPON\b.*\bSEALER CLEAR/, 'nippon-sealer-clear'], [/\bNIPPON SEALER\b/, 'nippon-sealer-colour'],
  [/\bNIPPON\b.*\bTOP COAT G[OL]+SS/, 'nippon-top-coat-gloss'], [/\bNIPPON\b.*\bTOP COAT MATT/, 'nippon-top-coat-matt'],
  [/\bNIPPON VARNISH CLEAR/, 'nippon-varnish-clear'], [/\bNIPPON VARNISH\b/, 'nippon-varnish'], [/\bNIPPON\b.*\bVIN[YL]+ SILK/, 'nippon-vinyl-silk'],
  [/\bNIPPON\b.*\bW\/STAIN\b/, 'nippon-wood-stain'], [/\bNIPPON\b.*\bWOOD FINISH GLOSS/, 'nippon-wood-finish-gloss'], [/\bNIPPON\b.*\bWOOD FINISH MATT/, 'nippon-wood-finish-matt'],
  [/\bNIPPON\b.*\bWOOD PUTTY/, 'nippon-wood-putty'], [/\bDULUX\b.*\b(W\/S|WEATHERSHIELD) POWERFLEXX?\b/, 'dulux-weathershield-powerflexx']];
const paintPhoto = (p) => {
  const n = String((p && p.name) || '').toUpperCase().replace(/\s+/g, ' ');
  const hit = PAINT_PHOTOS.find(([re]) => re.test(n));
  return hit ? '/img/products/paint/' + hit[1] + '.webp' : '';
};
const productPhoto = (p) => { const f = p && (PRODUCT_PHOTOS[p.oldCode] || PRODUCT_PHOTOS[p.code]); return f ? '/img/products/' + (f.includes('/') ? f : 'kevilton/' + f) : (pvcPhoto(p) || paintPhoto(p)); };
window.productPhoto = productPhoto;
})();
