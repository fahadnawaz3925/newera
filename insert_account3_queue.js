require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const BASE_URL = 'http://92.4.70.128:3000';

const files = [
  '1awesome_cat_reel_abyssinian.mp4',
  '2awesome_cat_reel_aegean.mp4',
  '3awesome_cat_reel_american_bobtail.mp4',
  '4awesome_cat_reel_american_curl.mp4',
  '5awesome_cat_reel_american_shorthair.mp4',
  '6awesome_cat_reel_american_wirehair.mp4',
  '7awesome_cat_reel_arabian_mau.mp4',
  '8awesome_cat_reel_australian_mist.mp4',
  '9awesome_cat_reel_balinese.mp4',
  '10awesome_cat_reel_bambino.mp4',
  '11awesome_cat_reel_bengal.mp4',
  '12awesome_cat_reel_birman.mp4',
  '13awesome_cat_reel_bombay.mp4',
  '14awesome_cat_reel_british_longhair.mp4',
  '15+awesome_cat_reel_british_shorthair.mp4',
  '16awesome_cat_reel_burmese.mp4',
  '17awesome_cat_reel_burmilla.mp4',
  '18awesome_cat_reel_california_spangled.mp4',
  '19awesome_cat_reel_chantilly-tiffany.mp4',
  '20awesome_cat_reel_chartreux.mp4',
  '21awesome_cat_reel_chausie.mp4',
  '22awesome_cat_reel_cheetoh.mp4',
  '23awesome_cat_reel_colorpoint_shorthair.mp4',
  '24awesome_cat_reel_cornish_rex.mp4',
  '25awesome_cat_reel_cymric.mp4',
  '26awesome_cat_reel_cyprus.mp4',
  '27awesome_cat_reel_devon_rex.mp4',
  '28awesome_cat_reel_donskoy.mp4',
  '29awesome_cat_reel_dragon_li.mp4',
  '30awesome_cat_reel_persian.mp4',
  '31awesome_cat_reel_scottish_fold.mp4',
  '32awesome_cat_reel_siamese.mp4',
  '33awesome_cat_reel_sphynx.mp4'
];

async function insertQueue() {
  const records = files.map(file => ({ url: `${BASE_URL}/${encodeURIComponent(file)}`, status: 'PENDING', account_id: 'account3' }));
  const { data, error } = await supabase.from('reels_queue').insert(records);
  if (error) console.error(error); 
  else console.log('Inserted ' + records.length + ' records');
}

insertQueue();
