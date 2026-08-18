import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

LINKS_FILE = "accout_2 links"
DOWNLOAD_DIR = "downloaded_videos"

def download_video(url):
    try:
        filename = url.split('/')[-1]
        filepath = os.path.join(DOWNLOAD_DIR, filename)
        
        if os.path.exists(filepath):
            print(f"Already exists: {filename}")
            return
            
        print(f"Downloading {filename}...")
        urllib.request.urlretrieve(url, filepath)
        print(f"Success: {filename}")
    except Exception as e:
        print(f"Failed {url}: {e}")

def main():
    if not os.path.exists(DOWNLOAD_DIR):
        os.makedirs(DOWNLOAD_DIR)
        
    with open(LINKS_FILE, 'r') as f:
        links = [line.strip() for line in f if line.strip()]
        
    print(f"Starting download of {len(links)} videos...")
    
    # Download 5 at a time for speed
    with ThreadPoolExecutor(max_workers=5) as executor:
        executor.map(download_video, links)
        
    print("All downloads completed!")

if __name__ == "__main__":
    main()
