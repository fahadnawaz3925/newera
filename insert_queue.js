require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const urls = [
"http://92.4.70.128:3000/awesome_cat_reel_abyssinian.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_aegean.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_american_bobtail.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_american_curl.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_american_shorthair.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_american_wirehair.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_arabian_mau.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_australian_mist.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_balinese.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_bambino.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_bengal.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_birman.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_bombay.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_british_longhair.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_british_shorthair.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_burmese.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_burmilla.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_california_spangled.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_chantilly-tiffany.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_chartreux.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_chausie.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_cheetoh.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_colorpoint_shorthair.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_cornish_rex.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_cymric.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_cyprus.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_devon_rex.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_donskoy.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_dragon_li.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_persian.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_scottish_fold.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_siamese.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_sphynx.mp4",
"http://92.4.70.128:3000/awesome_cat_reel_v3.mp4"
];

async function run() {
  let inserted = 0;
  for (const urlStr of urls) {
    const { data: existing } = await supabase.from('reels_queue').select('id').eq('url', urlStr).eq('account_id', 'account3');
    if (existing && existing.length > 0) {
      console.log(`Skipping ${urlStr} (already exists)`);
      continue;
    }
    
    console.log(`Inserting ${urlStr}...`);
    const { error } = await supabase.from('reels_queue').insert([{
      account_id: 'account3',
      url: urlStr,
      status: 'PENDING'
    }]);
    if (error) {
      console.error('Error inserting:', error);
    } else {
      inserted++;
    }
  }
  console.log(`Done! Inserted ${inserted} new URLs into account3 queue.`);
}
run();
