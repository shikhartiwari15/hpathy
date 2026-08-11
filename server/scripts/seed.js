import { pool, withTransaction } from '../src/db.js';

// Default potency ladder, in the order they should display.
const POTENCIES = ['Q/1X', '2X', '3X', '4X', '6X', '8X', '12X', '6C', '30C', '200C', '1M', '10M'];

// Default pack sizes (configurable like potencies).
const PACK_SIZES = ['30 ML', '100 ML'];

// A spread across the alphabet so the A-Z filter, list, and detail page all
// have something to show. Stock is keyed by potency name.
const MEDICINES = [
  {
    name: 'Abies Canadensis', abbreviation: 'Abies-c.', kingdom: 'Plant', common_name: 'Pinus Canadensis',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 110,
    short_description: 'Gnawing hunger, gastric complaints and prolapse sensations.',
    indications: 'Abies Canadensis suits gastric and uterine complaints with a peculiar craving for coarse food, meat and pickles. Marked by a faint, gone feeling at the stomach, palpitation and a sensation as if everything were relaxed and would fall out.',
    stock: { '30C': 1 },
  },
  {
    name: 'Acetanilidum', abbreviation: 'Acetan.', kingdom: 'Synthetic',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 105,
    short_description: 'Cyanosis, cardiac weakness and blood changes.',
    indications: 'Acetanilidum is associated with profound weakness, cyanosis and cardiac depression. Useful where the blood is altered, with pale, dusky skin and a weak, irregular pulse.',
    stock: { '3X': 1 },
  },
  {
    name: 'Acidum Fluoricum', abbreviation: 'Fl-ac.', kingdom: 'Mineral',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 120,
    short_description: 'Bone affections, varicose veins and old fistulae.',
    indications: 'Acidum Fluoricum acts on the lower tissues, bones, and capillary circulation. Indicated in chronic conditions with deep-seated destructive processes, varicose veins, and a general aggravation from warmth.',
    stock: { '30C': 1, '1M': 1 },
  },
  {
    name: 'Belladonna', abbreviation: 'Bell.', kingdom: 'Plant', common_name: 'Deadly Nightshade',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Sudden high fever, throbbing headache and red hot skin.',
    indications: 'Belladonna is the remedy of sudden, violent onset with heat, redness, throbbing and burning. Suited to congestive states of the head, high fever with a hot red face, dilated pupils and hypersensitivity to light, noise and touch.',
    stock: { '30C': 12, '200C': 6, '1M': 2 },
  },
  {
    name: 'Bryonia Alba', abbreviation: 'Bry.', kingdom: 'Plant', common_name: 'White Bryony',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Dryness of mucous membranes, stitching pains worse from motion.',
    indications: 'Bryonia is marked by dryness everywhere and stitching, tearing pains that are worse from the least movement and better from firm pressure and rest. Great thirst for large quantities at long intervals; irritable and wants to be left alone.',
    stock: { '6C': 4, '30C': 10, '200C': 3 },
  },
  {
    name: 'Calcarea Carbonica', abbreviation: 'Calc.', kingdom: 'Mineral',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 100,
    short_description: 'Chilly, sweaty, sluggish constitutions with easy fatigue.',
    indications: 'Calcarea Carbonica suits fair, flabby, chilly patients who perspire easily, especially on the head. Slow development, craving for eggs and indigestibles, and a general state of weakness and apprehension.',
    stock: { '30C': 8, '200C': 5, '1M': 1 },
  },
  {
    name: 'Drosera Rotundifolia', abbreviation: 'Dros.', kingdom: 'Plant', common_name: 'Sundew',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Deep, spasmodic, barking cough worse after midnight.',
    indications: 'Drosera is a leading remedy for spasmodic, barking and whooping cough that comes in rapid succession, worse after midnight and on lying down. Tickling in the larynx, retching and a hoarse, deep voice.',
    stock: { '30C': 6, '200C': 2 },
  },
  {
    name: 'Elaterium', abbreviation: 'Elat.', kingdom: 'Plant', common_name: 'Squirting Cucumber',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 115,
    short_description: 'Helps in Colic, Cramps, Diarrhoea, Dysentery, Fever, Jaundice, Urticaria.',
    indications: 'Elaterium is a powerful and distinctive homoeopathic medicine prepared from the tincture of the unripe fruit of Ecballium elaterium (Squirting Cucumber), belonging to the Cucurbitaceae family. It is well known for its marked purgative action and specific influence on the gastrointestinal system, serous membranes, and lower limbs. This medicine is particularly suited for acute conditions involving profuse watery diarrhoea, dropsy, neuralgia, intermittent fever, and sciatica. It is characterised by forcible discharges, abdominal griping, gaping before chills, and intense fatigue. Elaterium is also notable for its effects on the hepatic system, blood, and mucous membranes, making it valuable in cases of jaundice, bilious states, and eruptive fevers.\n\nAbdominal pain and Jaundice: Aids in sudden, forcible diarrhoea that gushes out with a squirt-like effect. Indicated in dull olive-green, frothy, or watery discharges from the bowels. Helps in cutting and griping abdominal pains, often associated with colic or bilious states. Supports vomiting of greenish or watery fluid with marked prostration. Useful in jaundice with hepatic sluggishness, bilious vomiting, and general weakness.',
    stock: { '6C': 2, '12X': 1, '30C': 3, '200C': 1, '1M': 1 },
  },
  {
    name: 'Gelsemium Sempervirens', abbreviation: 'Gels.', kingdom: 'Plant', common_name: 'Yellow Jasmine',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 100,
    short_description: 'Drowsy, dull, dizzy fevers and anticipatory anxiety.',
    indications: 'Gelsemium suits states of dullness, drowsiness and trembling weakness. A leading influenza remedy with heaviness of the eyelids, aching muscles, chills up and down the spine and thirstlessness. Also for anticipatory anxiety with diarrhoea before an event.',
    stock: { '30C': 9, '200C': 4 },
  },
  {
    name: 'Hepar Sulphuris', abbreviation: 'Hep.', kingdom: 'Mineral',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 100,
    short_description: 'Oversensitive, chilly, suppurating conditions.',
    indications: 'Hepar Sulph is intensely sensitive to touch, cold and pain, and hastens or aborts suppuration. Splinter-like pains, croupy cough, and a chilly patient who cannot bear to be uncovered. Discharges are offensive.',
    stock: { '6C': 3, '30C': 7, '200C': 2 },
  },
  {
    name: 'Ipecacuanha', abbreviation: 'Ip.', kingdom: 'Plant', common_name: 'Ipecac Root',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Persistent nausea, clean tongue, spasmodic cough.',
    indications: 'Ipecacuanha is characterised by constant nausea not relieved by vomiting, with a surprisingly clean tongue. Useful in gastric upsets, spasmodic and suffocative cough, and bright-red haemorrhages with nausea.',
    stock: { '6C': 2, '30C': 5 },
  },
  {
    name: 'Lycopodium Clavatum', abbreviation: 'Lyc.', kingdom: 'Plant', common_name: 'Club Moss',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 105,
    short_description: 'Flatulent digestion, right-sided complaints, evening aggravation.',
    indications: 'Lycopodium suits digestive weakness with bloating and fullness after a little food, craving for sweets, and right-sided symptoms that often move left to right. Aggravation from 4 to 8 pm; lacking confidence outwardly yet domineering at home.',
    stock: { '30C': 11, '200C': 6, '1M': 2 },
  },
  {
    name: 'Nux Vomica', abbreviation: 'Nux-v.', kingdom: 'Plant', common_name: 'Poison Nut',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Irritable, oversensitive, digestive and sedentary complaints.',
    indications: 'Nux Vomica suits the ambitious, irritable and oversensitive, especially from overwork, stimulants and sedentary habits. Ineffectual urging for stool, chilliness, and aggravation in the early morning and from cold.',
    stock: { '6C': 4, '30C': 14, '200C': 5, '1M': 1 },
  },
  {
    name: 'Pulsatilla Nigricans', abbreviation: 'Puls.', kingdom: 'Plant', common_name: 'Wind Flower',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Mild, weepy, changeable symptoms better in open air.',
    indications: 'Pulsatilla is the remedy of changeable, shifting symptoms in a mild, yielding and tearful patient who craves sympathy and open air. Thirstlessness, bland thick discharges and aggravation in a warm stuffy room are characteristic.',
    stock: { '30C': 10, '200C': 4 },
  },
  {
    name: 'Rhus Toxicodendron', abbreviation: 'Rhus-t.', kingdom: 'Plant', common_name: 'Poison Ivy',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 95,
    short_description: 'Restless, rheumatic pains better from continued motion.',
    indications: 'Rhus Tox suits rheumatic and joint complaints that are worse on first motion and from rest, and better from continued movement and warmth. Great restlessness, stiffness, and a tearing pain relieved by stretching.',
    stock: { '30C': 13, '200C': 6, '1M': 2 },
  },
  {
    name: 'Sulphur', abbreviation: 'Sulph.', kingdom: 'Mineral',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 90,
    short_description: 'Hot, itching, relapsing skin and untidy constitutions.',
    indications: 'Sulphur is a great anti-psoric remedy suited to hot patients with burning, itching skin worse from warmth and washing, morning diarrhoea, and a tendency for complaints to relapse. Often used to restart a well-chosen remedy that has stopped acting.',
    stock: { '30C': 15, '200C': 7, '1M': 3 },
  },
  {
    name: 'Thuja Occidentalis', abbreviation: 'Thuj.', kingdom: 'Plant', common_name: 'Arbor Vitae',
    material_type: 'DILUTIONS & POTENCIES', pack_size: '30 ML', mrp: 100,
    short_description: 'Warty growths, fixed ideas and sycotic complaints.',
    indications: 'Thuja is a chief anti-sycotic remedy for warty and fig-like growths, oily skin, and fixed ideas. Aggravation from cold damp weather and at night; sweat only on uncovered parts.',
    stock: { '30C': 8, '200C': 3 },
  },
];

await withTransaction(async (c) => {
  // Potencies
  for (let i = 0; i < POTENCIES.length; i++) {
    await c.query(
      `INSERT INTO potencies (name, sort_order) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [POTENCIES[i], i + 1]
    );
  }
  const pRows = (await c.query('SELECT id, name FROM potencies')).rows;
  const pMap = new Map(pRows.map(p => [p.name, p.id]));

  // Pack sizes
  for (let i = 0; i < PACK_SIZES.length; i++) {
    await c.query(
      `INSERT INTO pack_sizes (name, sort_order) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [PACK_SIZES[i], i + 1]
    );
  }
  const psRows = (await c.query('SELECT id, name FROM pack_sizes ORDER BY sort_order ASC, id ASC')).rows;
  const defaultPackId = psRows[0]?.id;
  if (!defaultPackId) throw new Error('No pack sizes available after seed');

  // Medicines + stock
  for (const m of MEDICINES) {
    const up = await c.query(
      `INSERT INTO medicines
         (name, abbreviation, kingdom, common_name, material_type, pack_size, short_description, indications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (lower(name)) DO UPDATE SET
         abbreviation=EXCLUDED.abbreviation, kingdom=EXCLUDED.kingdom, common_name=EXCLUDED.common_name,
         material_type=EXCLUDED.material_type, pack_size=EXCLUDED.pack_size,
         short_description=EXCLUDED.short_description, indications=EXCLUDED.indications, updated_at=now()
       RETURNING id`,
      [m.name, m.abbreviation, m.kingdom, m.common_name || null, m.material_type,
       m.pack_size, m.short_description, m.indications]
    );
    const mid = up.rows[0].id;
    for (const [pname, qty] of Object.entries(m.stock || {})) {
      const pid = pMap.get(pname);
      if (!pid) continue;
      await c.query(
        `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity, min_level)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (medicine_id, potency_id, pack_size_id)
         DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=now()`,
        [mid, pid, defaultPackId, qty, 2]
      );
    }
  }
});

console.log(`Seeded ${POTENCIES.length} potencies, ${PACK_SIZES.length} pack sizes and ${MEDICINES.length} medicines.`);
await pool.end();
