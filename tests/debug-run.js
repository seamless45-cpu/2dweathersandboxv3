/* Debug driver: track charge ledger pieces + vertical charge profile. */
'use strict';
const {StormSim} = require('../stormsim.js');
const {buildStormEnv} = require('./stormEnv.js');

const env = buildStormEnv();
const sim = new StormSim({
  seed: 4242, maxParticles: 16000, chargeRate: 2.0,
  widthM: env.wCells * env.cellSizeM, heightM: env.hCells * env.cellSizeM,
  wrapX: false, fieldNX: 96, fieldNY: 64
});
sim.setEnvironment(env);

const H = env.hCells * env.cellSizeM;
function chargeProfile() {
  const P = sim.particles, bins = 12, prof = [];
  for (let b = 0; b < bins; b++) prof.push({pos: 0, neg: 0});
  for (let i = 0; i < P.count; i++) {
    const b = Math.min(bins - 1, Math.floor((P.y[i] / env.hCells) * bins));
    if (P.charge[i] > 0) prof[b].pos += P.charge[i]; else prof[b].neg += P.charge[i];
  }
  return prof.map((p, b) => `${(b + 0.5) * H / bins / 1000}km:${(p.pos + p.neg).toExponential(1)}`).join(' ');
}
function ledgerLine(tag) {
  const L = sim.ledger;
  const sum = sim._inAirChargeQuick();
  console.log(`t=${tag} inAir=${sum.toExponential(2)} chan=${L.channel.toExponential(2)} ground=${L.ground.toExponential(2)} rain=${L.rainout.toExponential(2)} leak=${L.leaked.toExponential(2)} total=${(sum + L.channel + L.ground + L.rainout + L.leaked).toExponential(2)}`);
}

for (let m = 0; m <= 600; m += 120) {
  for (let s = 0; s < 240; s++) sim.step(0.5);
  ledgerLine(m + 30);
  const st = sim.getStats();
  console.log(`   maxE=${st.maxField.toExponential(2)} flashes=${st.flashes} N=${st.particles} up+=${st.structure.upperPositive.toExponential(1)} midN=${st.structure.mainNegative.toExponential(1)} lo+=${st.structure.lowerPositive.toExponential(1)}`);
  // channel liveness / stuck-charge audit
  let liveMoved = 0, nLead = 0, nStroke = 0, nDecay = 0, nCG = 0;
  for (const ch of sim.getChannels()) {
    liveMoved += ch.chargeMoved || 0;
    if (ch.state === 'leader') nLead++; else if (ch.state === 'stroke') nStroke++; else nDecay++;
    if (ch.toGround) nCG++;
  }
  console.log(`   channels: n=${sim.getChannels().length} lead=${nLead} stroke=${nStroke} decay=${nDecay} cg=${nCG} liveMoved=${liveMoved.toExponential(2)}`);
  console.log('   prof:', chargeProfile());
  if (m >= 360) {
    // debrief: charge per particle type x altitude bin
    const P = sim.particles;
    const names = ['cloud', 'super', 'ice', 'snow', 'graupel', 'hail', 'rain'];
    const rows = {};
    for (const n of names) rows[n] = new Float64Array(7);
    for (let i = 0; i < P.count; i++) {
      const ykm = Math.min(6, Math.floor(P.y[i] / (sim.env.hCells / 7)));
      rows[names[P.type[i]]][ykm] += P.charge[i];
    }
    console.log('   type x alt (km bands of 12/7):');
    for (const n of names) console.log('     ' + n.padEnd(8), Array.from(rows[n], v => v.toExponential(1)).join(' '));
  }
}
