document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('poster-form');
  const urlsInput = document.getElementById('urls');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = document.querySelector('.btn-text');
  const btnLoader = document.getElementById('btn-loader');
  
  const pendingList = document.getElementById('pending-list');
  const activityList = document.getElementById('activity-list');
  const emptyQueueMessage = document.getElementById('empty-queue-message');
  const restartLoopBtn = document.getElementById('restart-loop-btn');
  const loopLoader = document.getElementById('loop-loader');
  const clearActivityBtn = document.getElementById('clear-activity-btn');
  const clearLoader = document.getElementById('clear-loader');
  const selectAllActivityCheckbox = document.getElementById('select-all-activity');
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const selectedCountSpan = document.getElementById('selected-count');
  const selectedLoader = document.getElementById('selected-loader');

  const selectedActivityIds = new Set();

  let isDragging = false;

  // Initialize Drag and Drop for Pending Queue
  const sortable = new Sortable(pendingList, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    onStart: () => {
      isDragging = true; // Pause polling while dragging
    },
    onEnd: async (evt) => {
      isDragging = false;
      const items = Array.from(pendingList.querySelectorAll('.tracker-item'));
      const orderedIds = items.map(item => item.dataset.id);
      
      try {
        await fetch('/api/api-queue', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds })
        });
      } catch (err) {
        console.error('Failed to reorder:', err);
      }
    }
  });

  // Fetch and display queue on load
  fetchQueue();
  // Poll queue every 10 seconds
  setInterval(() => {
    if (!isDragging) fetchQueue();
  }, 10000);
  
  // Re-fetch when account selection changes
  const accountSelect = document.getElementById('account-select');
  if (accountSelect) {
    accountSelect.addEventListener('change', () => {
      selectedActivityIds.clear();
      updateSelectedUI();
      fetchQueue();
    });
  }

  // FAIL-SAFE: Netlify free-tier Cron triggers can be extremely unreliable and suspend if there's no traffic.
  // Since you keep the dashboard open, this will ping the worker every 2 minutes. 
  // The backend organic delay logic (20-25 mins) will safely block any premature execution,
  // but this guarantees the post goes out exactly when the timer hits zero without relying on Netlify's cron.
  setInterval(() => {
    console.log('Sending heartbeat to background worker...');
    fetch('/api/process-worker-background', { method: 'POST' }).catch(console.error);
  }, 2 * 60 * 1000); // Every 2 minutes

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Parse URLs
    const rawUrls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u);
    const files = document.getElementById('file-upload').files;
    
    // Get Account Selection
    const accountSelect = document.getElementById('account-select');
    const accountId = accountSelect ? accountSelect.value : 'account1';
    
    if (rawUrls.length === 0 && files.length === 0) {
      alert('Please enter at least one URL or select a file to upload.');
      return;
    }

    // Set UI to loading state
    submitBtn.disabled = true;
    btnText.textContent = 'Adding to Queue...';
    btnLoader.classList.remove('hidden');
    
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status');
    
    try {
      // 1. Handle File Uploads first
      if (files.length > 0) {
        progressContainer.classList.remove('hidden');
        statusText.textContent = `Preparing ${files.length} file(s) for upload...`;
        
        const uploadPromises = Array.from(files).map(async (file, index) => {
          // Get signed URL
          const signRes = await fetch('/api/api-upload-url', {
            method: 'POST',
            body: JSON.stringify({ 
              fileName: file.name,
              contentType: file.type || 'application/octet-stream'
            })
          });
          const signData = await signRes.json();
          if (!signRes.ok) throw new Error('Failed to get upload URL: ' + signData.error);
          
          // Upload to R2 directly
          const uploadRes = await fetch(signData.signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
              'Content-Type': file.type || 'application/octet-stream'
            }
          });
          
          if (!uploadRes.ok) throw new Error(`Failed to upload ${file.name}`);
          
          // Update visual progress (approximate for concurrent)
          progressBar.style.width = `${((index + 1) / files.length) * 100}%`;
          
          return `supabase://${signData.storagePath}`;
        });

        statusText.textContent = `Uploading ${files.length} file(s) in parallel (this depends on your WiFi upload speed)...`;
        const uploadedPaths = await Promise.all(uploadPromises);
        rawUrls.push(...uploadedPaths);
        
        progressBar.style.width = '100%';
        statusText.textContent = 'Upload complete! Adding to queue...';
      }

      // 2. Submit to Queue
      const res = await fetch('/api/api-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: rawUrls, accountId })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add to queue');
      
      // Clear inputs
      urlsInput.value = '';
      document.getElementById('file-upload').value = '';
      
      // Kick off the background worker instantly so the first video starts NOW
      fetch('/api/process-worker-background', { method: 'POST' }).catch(e => console.error(e));

      // Fetch updated queue immediately
      await fetchQueue();
      
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      // Reset UI
      submitBtn.disabled = false;
      btnText.textContent = 'Add to Queue';
      btnLoader.classList.add('hidden');
      if (progressContainer) progressContainer.classList.add('hidden');
    }
  });

  restartLoopBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to restart the loop? This will move all previously published and failed videos back into the pending queue to be posted again.')) return;
    
    restartLoopBtn.disabled = true;
    loopLoader.classList.remove('hidden');
    
    try {
      const accountSelect = document.getElementById('account-select');
      const accountId = accountSelect ? accountSelect.value : 'account1';

      const res = await fetch('/api/reset-queue', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId })
      });
      if (!res.ok) throw new Error('Failed to reset queue');
      alert(`Queue for ${accountId === 'account2' ? 'Account 2' : 'Account 1'} successfully reset!`);
      await fetchQueue();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      restartLoopBtn.disabled = false;
      loopLoader.classList.add('hidden');
    }
  });

  function updateSelectedUI() {
    const count = selectedActivityIds.size;
    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (deleteSelectedBtn) {
      if (count > 0) {
        deleteSelectedBtn.classList.remove('hidden');
      } else {
        deleteSelectedBtn.classList.add('hidden');
      }
    }
    
    const checkboxes = activityList.querySelectorAll('.activity-checkbox');
    if (selectAllActivityCheckbox) {
      if (checkboxes.length > 0 && selectedActivityIds.size === checkboxes.length) {
        selectAllActivityCheckbox.checked = true;
        selectAllActivityCheckbox.indeterminate = false;
      } else if (selectedActivityIds.size > 0 && selectedActivityIds.size < checkboxes.length) {
        selectAllActivityCheckbox.checked = false;
        selectAllActivityCheckbox.indeterminate = true;
      } else {
        selectAllActivityCheckbox.checked = false;
        selectAllActivityCheckbox.indeterminate = false;
      }
    }
  }

  if (activityList) {
    activityList.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('activity-checkbox')) {
        const id = e.target.dataset.id;
        if (e.target.checked) {
          selectedActivityIds.add(id);
        } else {
          selectedActivityIds.delete(id);
        }
        updateSelectedUI();
      }
    });
  }

  if (selectAllActivityCheckbox) {
    selectAllActivityCheckbox.addEventListener('change', () => {
      const checkboxes = activityList.querySelectorAll('.activity-checkbox');
      if (selectAllActivityCheckbox.checked) {
        checkboxes.forEach(cb => {
          cb.checked = true;
          selectedActivityIds.add(cb.dataset.id);
        });
      } else {
        checkboxes.forEach(cb => {
          cb.checked = false;
          selectedActivityIds.delete(cb.dataset.id);
        });
      }
      updateSelectedUI();
    });
  }

  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedActivityIds);
      if (ids.length === 0) return;
      
      if (!confirm(`Are you sure you want to delete ${ids.length} selected item(s) from history?`)) return;
      
      deleteSelectedBtn.disabled = true;
      if (selectedLoader) selectedLoader.classList.remove('hidden');
      
      try {
        const res = await fetch('/api/api-queue', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to delete selected items');
        }
        
        selectedActivityIds.clear();
        updateSelectedUI();
        await fetchQueue();
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        deleteSelectedBtn.disabled = false;
        if (selectedLoader) selectedLoader.classList.add('hidden');
      }
    });
  }

  if (clearActivityBtn) {
    clearActivityBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all published and failed items from the history?')) return;
      
      clearActivityBtn.disabled = true;
      if (clearLoader) clearLoader.classList.remove('hidden');
      
      try {
        const accountSelect = document.getElementById('account-select');
        const accountId = accountSelect ? accountSelect.value : 'account1';
        
        const res = await fetch('/api/api-queue', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clearAll: true, accountId })
        });
        if (!res.ok) throw new Error('Failed to clear activity');
        selectedActivityIds.clear();
        updateSelectedUI();
        await fetchQueue();
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        clearActivityBtn.disabled = false;
        if (clearLoader) clearLoader.classList.add('hidden');
      }
    });
  }

  async function fetchQueue() {
    try {
      const accountSelect = document.getElementById('account-select');
      const accountId = accountSelect ? accountSelect.value : 'account1';
      
      const res = await fetch(`/api/api-queue?accountId=${accountId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch queue');
      
      renderQueue(data.queue);
      startCountdownTimer(data.lastPublished, data.queue);
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }

  let countdownInterval = null;

  function startCountdownTimer(lastPublished, queueItems = []) {
    const timerSpan = document.getElementById('next-post-timer');
    if (!timerSpan) return;
    
    if (countdownInterval) clearInterval(countdownInterval);
    
    timerSpan.style.display = 'inline-block';
    
    const activeItems = queueItems.filter(item => item.status === 'PENDING' || item.status === 'PROCESSING');
    if (activeItems.length === 0) {
      timerSpan.textContent = 'Next post: Queue empty';
      timerSpan.style.background = 'rgba(107, 114, 128, 0.1)';
      timerSpan.style.color = '#9ca3af';
      timerSpan.style.borderColor = 'rgba(107, 114, 128, 0.2)';
      return;
    }
    
    const isCurrentlyProcessing = queueItems.some(item => item.status === 'PROCESSING');
    if (isCurrentlyProcessing) {
      timerSpan.textContent = 'Next post: Currently processing... ⚡';
      timerSpan.style.background = 'rgba(59, 130, 246, 0.1)';
      timerSpan.style.color = '#60a5fa';
      timerSpan.style.borderColor = 'rgba(59, 130, 246, 0.2)';
      return;
    }

    if (!lastPublished || lastPublished === 0) {
      timerSpan.textContent = 'Next post: Due now (Processing...)';
      timerSpan.style.background = 'rgba(16, 185, 129, 0.1)';
      timerSpan.style.color = '#34d399';
      timerSpan.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      return;
    }
    
    const updateTimer = () => {
      const targetTime = lastPublished + (20 * 60 * 1000); // 20 mins minimum interval
      const now = Date.now();
      const diff = targetTime - now;
      
      if (diff <= 0) {
        timerSpan.textContent = 'Next post: Due now (Posting...) 🚀';
        timerSpan.style.background = 'rgba(245, 158, 11, 0.1)';
        timerSpan.style.color = '#fbbf24';
        timerSpan.style.borderColor = 'rgba(245, 158, 11, 0.2)';
        
        // Trigger background worker if overdue
        if (!window.hasTriggeredWorkerForThisDrop) {
          window.hasTriggeredWorkerForThisDrop = true;
          fetch('/api/process-worker-background', { method: 'POST' }).catch(console.error);
        }
      } else {
        window.hasTriggeredWorkerForThisDrop = false;
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        timerSpan.textContent = `Next post in ~${mins}m ${secs}s`;
        timerSpan.style.background = 'rgba(16, 185, 129, 0.1)';
        timerSpan.style.color = '#34d399';
        timerSpan.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      }
    };
    
    updateTimer(); // Initial call
    countdownInterval = setInterval(updateTimer, 1000);
  }

  // Global delete function
  window.deleteQueueItem = async function(id) {
    if (!confirm('Are you sure you want to remove this video from history/queue?')) return;
    
    try {
      const res = await fetch('/api/api-queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        selectedActivityIds.delete(id);
        updateSelectedUI();
        fetchQueue();
      } else {
        const data = await res.json();
        alert('Failed to delete: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  function renderQueue(queue) {
    if (!queue || queue.length === 0) {
      pendingList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">Queue is empty. Add some URLs above!</div>';
      activityList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">No recent activity.</div>';
      updateSelectedUI();
      return;
    }

    let pendingHtml = '';
    let activityHtml = '';
    let pendingCount = 0;
    
    queue.forEach(item => {
      const statusClass = item.status.toLowerCase();
      let logHtml = '';
      if (item.error_log) {
        logHtml = `<div class="tracker-logs error">${item.error_log}</div>`;
      } else if (item.status === 'PUBLISHED') {
        logHtml = `<div class="tracker-logs">Published successfully!</div>`;
      }

      if (item.status === 'PENDING') {
        pendingCount++;
        pendingHtml += `
          <div class="tracker-item ${statusClass}" data-id="${item.id}">
            <div class="tracker-header">
              <div class="tracker-url-container">
                <span class="drag-handle" title="Drag to reorder">☰</span>
                <img src="/api/api-thumbnail?url=${encodeURIComponent(item.url)}" class="queue-thumbnail" onerror="this.style.display='none'" />
                <span class="tracker-url" title="${item.url}">${item.url}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="tracker-status-badge">${item.status}</span>
                <button class="delete-btn" onclick="deleteQueueItem('${item.id}')" title="Delete">🗑️</button>
              </div>
            </div>
            ${logHtml}
            <div style="font-size: 0.7rem; color: #64748b; margin-top: 5px; display: flex; align-items: center; gap: 6px;">
              <span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;">
                ${item.account_id === 'account2' ? 'Account 2' : 'Account 1'}
              </span>
              Queued: ${new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        `;
      } else {
        const isChecked = selectedActivityIds.has(item.id);
        activityHtml += `
          <div class="tracker-item ${statusClass}" data-id="${item.id}">
            <div class="tracker-header">
              <div class="tracker-url-container">
                <input type="checkbox" class="activity-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #ef4444; margin-right: 12px; flex-shrink: 0;" />
                <img src="/api/api-thumbnail?url=${encodeURIComponent(item.url)}" class="queue-thumbnail" onerror="this.style.display='none'" />
                <span class="tracker-url" title="${item.url}">${item.url}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="tracker-status-badge">${item.status}</span>
                <button class="delete-btn" onclick="deleteQueueItem('${item.id}')" title="Delete this item">🗑️</button>
              </div>
            </div>
            ${logHtml}
            <div style="font-size: 0.7rem; color: #64748b; margin-top: 5px; display: flex; align-items: center; gap: 6px;">
              <span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;">
                ${item.account_id === 'account2' ? 'Account 2' : 'Account 1'}
              </span>
              Queued: ${new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        `;
      }
    });

    if (pendingCount === 0 && queue.length > 0) {
      emptyQueueMessage.classList.remove('hidden');
      pendingList.classList.add('hidden');
    } else {
      emptyQueueMessage.classList.add('hidden');
      pendingList.classList.remove('hidden');
      pendingList.innerHTML = pendingHtml || '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">No pending videos.</div>';
    }
    
    activityList.innerHTML = activityHtml || '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">No recent activity.</div>';
    updateSelectedUI();
  }

  // --- LOW PERFORMANCE REEL ANALYZER & CLEANUP ---
  const analyzeReelsBtn = document.getElementById('analyze-reels-btn');
  const analyzeLoader = document.getElementById('analyze-loader');
  const analyzerResultsContainer = document.getElementById('analyzer-results-container');
  const analyzerAgeSelect = document.getElementById('analyzer-age-select');
  const analyzerViewsSelect = document.getElementById('analyzer-views-select');
  const analyzerStatusMsg = document.getElementById('analyzer-status-msg');
  const analyzerList = document.getElementById('analyzer-list');
  const deleteAllLowBtn = document.getElementById('delete-all-low-btn');
  const deleteAllLoader = document.getElementById('delete-all-loader');
  const lowCountSpan = document.getElementById('low-count');

  let scannedLowPosts = [];

  if (analyzeReelsBtn) {
    analyzeReelsBtn.addEventListener('click', scanLowPerformanceReels);
  }

  if (analyzerAgeSelect && analyzerViewsSelect) {
    analyzerAgeSelect.addEventListener('change', () => {
      if (!analyzerResultsContainer.classList.contains('hidden')) scanLowPerformanceReels();
    });
    analyzerViewsSelect.addEventListener('change', () => {
      if (!analyzerResultsContainer.classList.contains('hidden')) scanLowPerformanceReels();
    });
  }

  async function scanLowPerformanceReels() {
    const selectedAccount = accountSelect ? accountSelect.value : 'account1';
    const minAgeHours = analyzerAgeSelect ? analyzerAgeSelect.value : '24';
    const maxViews = analyzerViewsSelect ? analyzerViewsSelect.value : '10';

    analyzeReelsBtn.disabled = true;
    analyzeLoader.classList.remove('hidden');
    analyzerResultsContainer.classList.remove('hidden');
    analyzerStatusMsg.textContent = `Scanning Instagram for ${selectedAccount} (${minAgeHours}h+ old, < ${maxViews} views)...`;
    analyzerList.innerHTML = '<div style="text-align: center; padding: 1rem; color: #94a3b8;">Analyzing published reel metrics...</div>';

    try {
      const res = await fetch(`/api/api-analyze-reels?accountId=${selectedAccount}&minAgeHours=${minAgeHours}&maxViews=${maxViews}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze reels');
      }

      scannedLowPosts = data.posts || [];
      renderLowPerformanceList(scannedLowPosts, data);
    } catch (err) {
      console.error('Analyzer error:', err);
      analyzerStatusMsg.textContent = `⚠️ Error scanning reels: ${err.message}`;
      analyzerList.innerHTML = '';
      deleteAllLowBtn.classList.add('hidden');
    } finally {
      analyzeReelsBtn.disabled = false;
      analyzeLoader.classList.add('hidden');
    }
  }

  function renderLowPerformanceList(posts, data = {}) {
    lowCountSpan.textContent = posts.length;
    if (posts.length === 0) {
      analyzerStatusMsg.textContent = `🎉 Great news! Scanned ${data.totalScanned || 0} published reels — no underperforming reels found matching your criteria.`;
      analyzerList.innerHTML = '';
      deleteAllLowBtn.classList.add('hidden');
      return;
    }

    const note = data.hasInsightsPermission ? '' : ' (Filtered by low engagement/likes)';
    analyzerStatusMsg.textContent = `Scanned ${data.totalScanned || posts.length} reels. Found ${posts.length} low-performing reel(s) older than ${data.minAgeHoursThreshold || 24}h${note}:`;
    deleteAllLowBtn.classList.remove('hidden');

    let html = '';
    posts.forEach(post => {
      const thumbnailSrc = post.thumbnailUrl || '/api/api-thumbnail?url=' + encodeURIComponent(post.permalink);
      const viewsLabel = post.views !== null ? `👁️ ${post.views} views` : `❤️ ${post.likes} likes`;
      html += `
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; min-width: 200px;">
            <img src="${thumbnailSrc}" onerror="this.style.display='none'" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; flex-shrink: 0;" />
            <div style="overflow: hidden;">
              <a href="${post.permalink}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500; font-size: 0.85rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${post.caption || post.id}
              </a>
              <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">
                Posted ${post.ageHours} hrs ago &bull; ❤️ ${post.likes} &bull; 💬 ${post.comments}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 600; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem;">
              ${viewsLabel}
            </span>
            <button onclick="window.deleteSingleLowReel('${post.id}')" style="background: rgba(220, 38, 38, 0.2); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.4); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: background 0.2s;">
              🗑️ Delete
            </button>
          </div>
        </div>
      `;
    });
    analyzerList.innerHTML = html;
  }

  window.deleteSingleLowReel = async function(mediaId) {
    if (!confirm('Are you sure you want to permanently delete this reel from Instagram?')) return;
    const selectedAccount = accountSelect ? accountSelect.value : 'account1';

    try {
      const res = await fetch('/api/api-analyze-reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount, mediaId })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Reel deleted successfully!');
        scannedLowPosts = scannedLowPosts.filter(p => p.id !== mediaId);
        renderLowPerformanceList(scannedLowPosts);
        fetchQueue();
      } else {
        alert('Failed to delete reel: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error deleting reel: ' + err.message);
    }
  };

  if (deleteAllLowBtn) {
    deleteAllLowBtn.addEventListener('click', async () => {
      if (!scannedLowPosts.length) return;
      if (!confirm(`Are you sure you want to PERMANENTLY delete all ${scannedLowPosts.length} underperforming reel(s) from Instagram?`)) return;

      const selectedAccount = accountSelect ? accountSelect.value : 'account1';
      const mediaIds = scannedLowPosts.map(p => p.id);

      deleteAllLowBtn.disabled = true;
      deleteAllLoader.classList.remove('hidden');

      try {
        const res = await fetch('/api/api-analyze-reels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: selectedAccount, mediaIds })
        });
        const data = await res.json();
        if (res.ok) {
          alert(data.message || 'Reels deleted successfully!');
          scannedLowPosts = [];
          renderLowPerformanceList(scannedLowPosts);
          fetchQueue();
        } else {
          alert('Failed to delete reels: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error deleting reels: ' + err.message);
      } finally {
        deleteAllLowBtn.disabled = false;
        deleteAllLoader.classList.add('hidden');
      }
    });
  }
});
