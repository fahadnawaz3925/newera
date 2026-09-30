-- Create the reels_accounts table for dynamic configurations
CREATE TABLE IF NOT EXISTS public.reels_accounts (
  account_id text PRIMARY KEY,
  watermark_text text NOT NULL,
  caption_prompt text NOT NULL,
  hashtags text NOT NULL,
  fallback_title text NOT NULL,
  fallback_desc text NOT NULL,
  color_grade text,
  intro_text text
);

-- Seed the initial data for Account 1, 2, and 3
INSERT INTO public.reels_accounts (account_id, watermark_text, caption_prompt, hashtags, fallback_title, fallback_desc, color_grade)
VALUES 
  (
    'account1', 
    '@faith.canvas.99', 
    'You are an expert viral Instagram Reel caption writer for @faith.canvas.99 — an Islamic Reminders & Quran page. Analyze this video''s visual frame carefully and write a beautiful, heartfelt caption tailored to THIS specific video''s Islamic topic. \n\nRULES:\n- NEVER use any selling, promotional, or commercial language. We are NOT selling anything.\n- NEVER mention products, links, courses, "DM us", or anything transactional.\n- The ONLY call to action allowed is: "Follow @faith.canvas.99 for daily reminders 🤲🕊️"\n- Keep it sincere, warm, and spiritually uplifting.\n\nSTRUCTURE:\n1. An emotional hook that makes people pause.\n2. 2-3 sentences of heartfelt reflection related to THIS video''s specific topic.\n3. CTA: "Follow @faith.canvas.99 for daily reminders 🤲🕊️"\n4. 6-8 hashtags mixing trending & niche.',
    '#Islam #Quran #IslamicReminders #Deen #Allah #Sunnah #Muslim #DeenOverDunya #Taqwa',
    'A reminder your soul needed right now 🤲💚',
    'In the quiet moments of life, turn your heart to Allah. He is closer to you than you think. Trust His plan, even when the path feels unclear.',
    'none'
  ),
  (
    'account2', 
    '@buffedboujee', 
    'You are an expert viral Instagram Reel caption writer for @buffedboujee — a Leather Shoe Shine & ASMR page. Analyze this video''s visual frame carefully and write a caption that feels authentic, engaging, and tailored to THIS specific video.\n\nRULES:\n- NEVER use any selling, promotional, or commercial language. We are NOT selling anything.\n- NEVER mention products, prices, services, links, or "DM us".\n- The ONLY call to action allowed is: "Follow @buffedboujee for more satisfying content 👞✨"\n- Keep it conversational.\n\nSTRUCTURE:\n1. A short, punchy hook line that stops the scroll.\n2. 2-3 sentences describing what''s happening in THIS specific video.\n3. CTA: "Follow @buffedboujee for more satisfying content 👞✨"\n4. 6-8 hashtags mixing trending & niche.',
    '#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning',
    'Turn your sound UP for this 🎧🔥',
    'Watch this satisfying transformation — worn leather brought back to a gorgeous mirror shine. The sounds are everything 🤌',
    'vintage'
  ),
  (
    'account3', 
    '@thehouseofcobblers', 
    'You are an expert viral Instagram Reel caption writer for @thehouseofcobblers — celebrating the timeless workmanship of creating high quality, handmade Goodyear welted leather shoes. Analyze this video''s visual frame carefully and write a caption celebrating bespoke shoemaking.\n\nRULES:\n- NEVER use any selling, promotional, or commercial language. We are NOT selling anything.\n- The ONLY call to action allowed is: "Follow @thehouseofcobblers for the art of handmade shoemaking 👞✨"\n- Keep it sophisticated, appreciative, and conversational.\n\nSTRUCTURE:\n1. Short, punchy hook line.\n2. 2-3 sentences describing the master shoemaking craft in THIS specific video.\n3. CTA: "Follow @thehouseofcobblers for the art of handmade shoemaking 👞✨"\n4. 6-8 trending Goodyear welt / bespoke shoemaking hashtags.',
    '#TheHouseOfCobblers #GoodyearWelted #HandmadeShoes #BespokeShoes #Shoemaking #Cordwainer #Cobbler #LeatherCraft #ShoeArtisan #Menswear #BespokeFootwear #Craftsmanship #OddlySatisfying',
    'The mastery of Goodyear welted shoemaking 👞✨',
    'Watch master artisans handcraft luxury Goodyear welted leather shoes from raw hide to finished masterpiece. Follow @thehouseofcobblers for the finest in bespoke footwear craftsmanship.',
    'none'
  )
ON CONFLICT (account_id) DO UPDATE SET 
  watermark_text = EXCLUDED.watermark_text,
  caption_prompt = EXCLUDED.caption_prompt,
  hashtags = EXCLUDED.hashtags,
  fallback_title = EXCLUDED.fallback_title,
  fallback_desc = EXCLUDED.fallback_desc,
  color_grade = EXCLUDED.color_grade;

-- Add local_path and error_log updates if they don't exist
ALTER TABLE public.reels_queue ADD COLUMN IF NOT EXISTS local_path text;
-- Ensure error_log is text or jsonb (we'll assume text for now)
ALTER TABLE public.reels_queue ALTER COLUMN error_log TYPE text USING error_log::text;

-- Create the Stored Procedure (RPC) to atomically claim a queue item
CREATE OR REPLACE FUNCTION public.claim_next_queue_item(p_account_id text)
RETURNS SETOF public.reels_queue
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.reels_queue;
BEGIN
  -- We look for DOWNLOADED status now instead of PENDING
  SELECT *
  INTO v_item
  FROM public.reels_queue
  WHERE account_id = p_account_id AND status = 'DOWNLOADED'
  ORDER BY id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.reels_queue
    SET status = 'PROCESSING'
    WHERE id = v_item.id
    RETURNING * INTO v_item;
    
    RETURN NEXT v_item;
  END IF;
  
  RETURN;
END;
$$;

-- Create another RPC for the downloader worker to claim PENDING items
CREATE OR REPLACE FUNCTION public.claim_next_download_item()
RETURNS SETOF public.reels_queue
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.reels_queue;
BEGIN
  SELECT *
  INTO v_item
  FROM public.reels_queue
  WHERE status = 'PENDING'
  ORDER BY id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.reels_queue
    SET status = 'DOWNLOADING'
    WHERE id = v_item.id
    RETURNING * INTO v_item;
    
    RETURN NEXT v_item;
  END IF;
  
  RETURN;
END;
$$;
