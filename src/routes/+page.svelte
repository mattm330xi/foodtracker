<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';

  interface Entry {
    id: number;
    text: string;
    image: string;
    meal: string;
    created_at: string;
    day_notes: string;
    barcode_data: string | null;
  }

  interface Reaction {
    id: number;
    symptom: string;
    severity: number;
    notes: string;
    created_at: string;
  }

  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
  const SEVERITY_LABELS = ['', 'Mild', 'Moderate', 'Severe', 'Very Severe'];

  let entries: Entry[] = $state([]);
  let reactions: Reaction[] = $state([]);
  let selectedDate = $state(new Date().toISOString().slice(0, 10));
  let showCalendar = $state(false);
  let calendarMonth = $state(new Date().getMonth());
  let calendarYear = $state(new Date().getFullYear());
  let text = $state('');
  let imageBase64 = $state('');
  let cameraInput: HTMLInputElement;
  let deleteConfirm: number | null = $state(null);
  let deleteType: 'entry' | 'reaction' = $state('entry');
  let daysWithEntries: Set<string> = $state(new Set());
  let daysWithReactions: Set<string> = $state(new Set());
  let editingEntry: number | null = $state(null);
  let editMeal: string = $state('');
  let editTime: string = $state('');
  let dayNotes: string = $state('');
  let savingNotes = $state(false);

  // Date warning
  let showDateWarning = $state(false);
  let dateWarningType: 'past' | 'future' = $state('past');
  let pendingAddFn: (() => Promise<void>) | null = $state(null);
  let skipPastWarning = $state(false);

  // Reaction form
  let showReactionForm = $state(false);
  let reactionSymptom = $state('');
  let reactionSeverity = $state(1);
  let reactionNotes = $state('');
  let reactionError = $state('');

  // Barcode
  import BarcodeScanner from '$lib/BarcodeScanner.svelte';
  let showBarcode = $state(false);
  let scannedProduct: any = $state(null);
  let scannerStatus: 'idle' | 'scanning' | 'looking_up' | 'success' | 'error' = $state('idle');
  let errorMessage = $state('');
  let barcodeElapsed = $state(0);
  let barcodeTimer: ReturnType<typeof setInterval> | null = null;
  let isBusy = false;
  let scannerComponent: any = $state(null);
  let manualBarcode = $state('');
  const BARCODE_TIMEOUT_MS = 5000;

  // Favorites
  let favorites: any[] = $state([]);
  let showFavorites = $state(false);

  // Templates
  let templates: any[] = $state([]);
  let showTemplates = $state(false);
  let templateName = $state('');
  let showSaveTemplate = $state(false);

  // Timezone
  let timezone = $state('America/New_York');
  let username = $state('');

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  function isDateMismatch(): 'past' | 'future' | null {
    const todayStr = today();
    if (selectedDate === todayStr) return null;
    return selectedDate < todayStr ? 'past' : 'future';
  }

  function toTimezoneDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
  }

  function toTimezoneTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    });
  }

  function toTimezoneHours(iso: string) {
    return parseInt(new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone
    }));
  }

  function autoMeal() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return 'Breakfast';
    if (hour >= 10 && hour < 15) return 'Lunch';
    if (hour >= 17 && hour < 21) return 'Dinner';
    return 'Snacks';
  }

  async function loadEntries(date: string) {
    const res = await fetch(`/api/entries?date=${date}`);
    entries = await res.json();
  }

  async function loadReactions(date: string) {
    const res = await fetch(`/api/reactions?date=${date}`);
    reactions = await res.json();
  }

  async function loadDayNotes(date: string) {
    const res = await fetch(`/api/day-notes?date=${date}`);
    const data = await res.json();
    dayNotes = data.notes || '';
  }

  async function loadDaysWithEntries(year: number, month: number) {
    const eSet = new Set<string>();
    const rSet = new Set<string>();
    for (let day = 1; day <= getDaysInMonth(year, month); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const [eRes, rRes] = await Promise.all([
        fetch(`/api/entries?date=${dateStr}`),
        fetch(`/api/reactions?date=${dateStr}`)
      ]);
      const eData = await eRes.json();
      const rData = await rRes.json();
      if (eData.length > 0) eSet.add(dateStr);
      if (rData.length > 0) rSet.add(dateStr);
    }
    daysWithEntries = eSet;
    daysWithReactions = rSet;
  }

  onMount(async () => {
    const authRes = await fetch('/api/auth');
    const authData = await authRes.json();
    if (!authData.user) {
      window.location.href = '/login';
      return;
    }
    timezone = authData.user.timezone || 'America/New_York';
    username = authData.user.username;
    selectedDate = today();
    skipPastWarning = localStorage.getItem('ft_skipPastWarning') === 'true';

    loadEntries(selectedDate);
    loadReactions(selectedDate);
    loadDayNotes(selectedDate);
    loadDaysWithEntries(calendarYear, calendarMonth);
    loadFavorites();
    loadTemplates();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
  });

  $effect(() => {
    if (showBarcode) {
      scannedProduct = null;
      scannerStatus = 'idle';
      errorMessage = '';
      tick().then(() => scannerComponent?.startScanner());
      return () => { scannerComponent?.stopScanner(); };
    }
  });

  onDestroy(() => {
    if (barcodeTimer) { clearInterval(barcodeTimer); barcodeTimer = null; }
  });

  function selectDate(date: string) {
    selectedDate = date;
    showCalendar = false;
    showDateWarning = false;
    pendingAddFn = null;
    loadEntries(date);
    loadReactions(date);
    loadDayNotes(date);
  }

  function confirmDateWarning() {
    if (dateWarningType === 'past') {
      localStorage.setItem('ft_skipPastWarning', String(skipPastWarning));
    }
    showDateWarning = false;
    pendingAddFn?.();
  }

  function cancelDateWarning() {
    showDateWarning = false;
    pendingAddFn = null;
  }

  function goToToday() {
    const t = new Date();
    calendarMonth = t.getMonth();
    calendarYear = t.getFullYear();
    selectedDate = today();
    showCalendar = false;
    loadEntries(today());
    loadReactions(today());
    loadDayNotes(today());
    loadDaysWithEntries(calendarYear, calendarMonth);
  }

  function prevMonth() {
    if (calendarMonth === 0) { calendarMonth = 11; calendarYear--; }
    else calendarMonth--;
    loadDaysWithEntries(calendarYear, calendarMonth);
  }

  function nextMonth() {
    if (calendarMonth === 11) { calendarMonth = 0; calendarYear++; }
    else calendarMonth++;
    loadDaysWithEntries(calendarYear, calendarMonth);
  }

  function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
  }

  function formatDateDisplay(dateStr: string) {
    if (dateStr === today()) return 'Today';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: timezone });
    if (dateStr === yesterdayStr) return 'Yesterday';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone });
  }

  function compressImage(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = (h / w) * MAX; w = MAX; }
            else { w = (w / h) * MAX; h = MAX; }
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    imageBase64 = await compressImage(file);
  }

  async function addEntry() {
    if (!text && !imageBase64) return;
    const mismatch = isDateMismatch();
    if (mismatch === 'past' && !skipPastWarning) {
      dateWarningType = 'past';
      pendingAddFn = doAddEntry;
      showDateWarning = true;
      return;
    }
    if (mismatch === 'future') {
      dateWarningType = 'future';
      pendingAddFn = doAddEntry;
      showDateWarning = true;
      return;
    }
    await doAddEntry();
  }

  async function doAddEntry() {
    showDateWarning = false;
    pendingAddFn = null;
    const mismatch = isDateMismatch();
    const body: Record<string, unknown> = { text, image: imageBase64 };
    if (mismatch) body.date = selectedDate;
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      alert('Failed to save entry. The photo may be too large. Please try a smaller image.');
      return;
    }
    const { id, meal } = await res.json();
    entries = [...entries, { id, text, image: imageBase64, meal, created_at: new Date().toISOString(), day_notes: '', barcode_data: null }];
    text = '';
    imageBase64 = '';
    loadEntries(selectedDate);
    loadDaysWithEntries(calendarYear, calendarMonth);
  }


  function startEditEntry(entry: Entry) {
    editingEntry = entry.id;
    editMeal = entry.meal;
    const d = new Date(entry.created_at);
    const hours = parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }));
    const minutes = parseInt(d.toLocaleString('en-US', { minute: 'numeric', timeZone: timezone }));
    editTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  async function saveEditEntry(entry: Entry) {
    const d = new Date(entry.created_at);
    const localStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    const tzDate = new Date(`${localStr}T${editTime}:00`);
    const newIso = tzDate.toISOString();
    const res = await fetch('/api/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, meal: editMeal, created_at: newIso })
    });
    if (!res.ok) {
      alert('Failed to save changes. Please try again.');
      return;
    }
    entries = entries.map(e => e.id === entry.id ? { ...e, meal: editMeal, created_at: newIso } : e);
    editingEntry = null;
  }

  async function deleteItem() {
    if (deleteType === 'entry') {
      await fetch('/api/entries', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deleteConfirm }) });
      entries = entries.filter(e => e.id !== deleteConfirm);
    } else {
      await fetch('/api/reactions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deleteConfirm }) });
      reactions = reactions.filter(r => r.id !== deleteConfirm);
    }
    deleteConfirm = null;
  }

  async function addReaction() {
    reactionError = '';
    if (!reactionSymptom.trim()) {
      reactionError = 'Please enter a symptom.';
      return;
    }
    try {
      const res = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptom: reactionSymptom.trim(), severity: reactionSeverity, notes: reactionNotes })
      });
      if (!res.ok) throw new Error('Failed to save');
      const { id } = await res.json();
      reactions = [...reactions, { id, symptom: reactionSymptom.trim(), severity: reactionSeverity, notes: reactionNotes, created_at: new Date().toISOString() }];
      reactionSymptom = '';
      reactionSeverity = 1;
      reactionNotes = '';
      showReactionForm = false;
    } catch {
      reactionError = 'Failed to save reaction. Please try again.';
    }
  }

  async function saveDayNotes() {
    savingNotes = true;
    await fetch('/api/day-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: selectedDate, notes: dayNotes })
    });
    savingNotes = false;
  }

  async function loadFavorites() {
    const res = await fetch('/api/favorites');
    favorites = await res.json();
  }

  async function loadTemplates() {
    const res = await fetch('/api/templates');
    templates = await res.json();
  }

  async function favoriteEntry(entry: Entry) {
    if (!entry.text && !entry.image) return;
    await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: entry.text, image: entry.image, meal: entry.meal })
    });
    loadFavorites();
  }

  async function applyFavorite(fav: any) {
    text = fav.text || '';
    imageBase64 = fav.image || '';
    showFavorites = false;
  }

  async function deleteFavorite(id: number) {
    await fetch('/api/favorites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    favorites = favorites.filter((f: any) => f.id !== id);
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return;
    const grouped = groupedEntries();
    const items: string[] = [];
    for (const [meal, mealEntries] of Object.entries(grouped)) {
      for (const e of mealEntries) {
        if (e.text) items.push(`[${meal}] ${e.text}`);
      }
    }
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName, items: items.join('\n') })
    });
    templateName = '';
    showSaveTemplate = false;
    loadTemplates();
  }

  async function applyTemplate(tpl: any) {
    text = tpl.items;
    showTemplates = false;
  }

  async function deleteTemplate(id: number) {
    await fetch('/api/templates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    templates = templates.filter((t: any) => t.id !== id);
  }

  async function handleBarcodeDetected(code: string) {
    console.debug(`[Parent] handleBarcodeDetected: "${code}" busy=${isBusy}`);
    if (isBusy) return;
    isBusy = true;
    scannerStatus = 'looking_up';

    barcodeElapsed = 0;
    barcodeTimer = setInterval(() => { barcodeElapsed += 1; }, 1000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BARCODE_TIMEOUT_MS);
    const t0 = performance.now();

    try {
      console.debug('[Parent] fetching /api/barcode...');
      const res = await fetch(`/api/barcode?barcode=${encodeURIComponent(code)}`, {
        signal: controller.signal
      });
      console.debug(`[Parent] response: ${res.status} in ${(performance.now() - t0).toFixed(0)}ms`);

      if (!res.ok) {
        if (res.status === 404) throw new Error('Product not found in database.');
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }
      if (data.found === false) {
        throw new Error('Product not found in database.');
      }

      scannedProduct = data;
      scannerStatus = 'success';
      console.debug('[Parent] lookup success');
      scannerComponent?.stopScanner();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        errorMessage = 'Product lookup timed out (5s). Please try again.';
      } else {
        errorMessage = e.message || 'Failed to look up product.';
      }
      scannerStatus = 'error';
    } finally {
      clearTimeout(timeoutId);
      if (barcodeTimer) { clearInterval(barcodeTimer); barcodeTimer = null; }
      barcodeElapsed = 0;
      isBusy = false;
      console.debug('[Parent] isBusy released');
    }
  }

  async function addBarcodeAsEntry() {
    if (!scannedProduct) return;
    text = scannedProduct.name || '';
    imageBase64 = '';
    const mismatch = isDateMismatch();
    if (mismatch === 'past' && !skipPastWarning) {
      dateWarningType = 'past';
      pendingAddFn = doAddBarcodeAsEntry;
      showDateWarning = true;
      return;
    }
    if (mismatch === 'future') {
      dateWarningType = 'future';
      pendingAddFn = doAddBarcodeAsEntry;
      showDateWarning = true;
      return;
    }
    await doAddBarcodeAsEntry();
  }

  async function doAddBarcodeAsEntry() {
    showDateWarning = false;
    pendingAddFn = null;
    if (!scannedProduct) return;
    const barcodeData = JSON.stringify({
      name: scannedProduct.name,
      brand: scannedProduct.brand || '',
      ingredients: scannedProduct.ingredients || '',
      allergens: scannedProduct.allergens || [],
      image: scannedProduct.image || '',
      barcode: scannedProduct.barcode || '',
      warnings: scannedProduct.warnings || [],
    });
    const mismatch = isDateMismatch();
    const body: Record<string, unknown> = { text, image: '', barcode_data: barcodeData };
    if (mismatch) body.date = selectedDate;
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      alert('Failed to save entry.');
      return;
    }
    const { id, meal } = await res.json();
    entries = [...entries, { id, text, image: '', meal, created_at: new Date().toISOString(), day_notes: '', barcode_data: barcodeData }];
    text = '';
    showBarcode = false;
    scannedProduct = null;
    manualBarcode = '';
    loadEntries(selectedDate);
    loadDaysWithEntries(calendarYear, calendarMonth);
  }

  function timeOnly(iso: string) {
    return toTimezoneTime(iso);
  }

  function groupedEntries() {
    const groups: Record<string, Entry[]> = {};
    for (const m of MEALS) groups[m] = [];
    for (const e of entries) {
      const m = (MEALS as readonly string[]).includes(e.meal) ? e.meal : 'Snacks';
      groups[m].push(e);
    }
    return groups;
  }

  let calendarDays = $derived.by(() => {
    const daysInMonth = getDaysInMonth(calendarYear, calendarMonth);
    const firstDay = getFirstDayOfMonth(calendarYear, calendarMonth);
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  });
</script>

<svelte:head>
  <title>Food Tracker</title>
</svelte:head>

<main>
  <header>
    <div class="header-left">
      <h1>Food Tracker</h1>
      {#if username}<span class="username">@{username}</span>{/if}
    </div>
    <div class="header-btns">
      <a href="/stats" class="icon-btn">📈</a>
      <button class="icon-btn" onclick={() => showFavorites = true}>⭐</button>
      <button class="icon-btn" onclick={() => showTemplates = true}>📋</button>
      <button class="icon-btn" onclick={() => showBarcode = true} title="Scan barcode"><svg width="18" height="18" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="2" height="16" fill="currentColor"/><rect x="5" y="2" width="1" height="16" fill="currentColor"/><rect x="8" y="2" width="3" height="16" fill="currentColor"/><rect x="13" y="2" width="1" height="16" fill="currentColor"/><rect x="16" y="2" width="1" height="16" fill="currentColor"/></svg></button>
      <button class="icon-btn" onclick={() => showReactionForm = true}>⚠️</button>
      <button class="icon-btn" onclick={() => showCalendar = !showCalendar}>📅</button>
      <a href="/profile" class="icon-btn">👤</a>
    </div>
  </header>

  {#if showCalendar}
    <div class="calendar-overlay" onclick={() => showCalendar = false}></div>
    <div class="calendar">
      <div class="calendar-header">
        <button onclick={prevMonth}>‹</button>
        <span>{monthNames[calendarMonth]} {calendarYear}</span>
        <button onclick={nextMonth}>›</button>
      </div>
      <button class="today-btn" onclick={goToToday}>Today</button>
      <div class="calendar-days">
        {#each dayNames as d}
          <div class="day-label">{d}</div>
        {/each}
        {#each calendarDays as day}
          {#if day === null}
            <div class="day empty"></div>
          {:else}
            {@const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
            {@const isToday = dateStr === today()}
            {@const isSelected = dateStr === selectedDate}
            {@const hasEntries = daysWithEntries.has(dateStr)}
            {@const hasReaction = daysWithReactions.has(dateStr)}
            <button
              class="day"
              class:today={isToday}
              class:selected={isSelected}
              class:has-entries={hasEntries && !isToday && !isSelected}
              onclick={() => selectDate(dateStr)}
            >
              {day}
              {#if hasReaction}
                <span class="reaction-dot"></span>
              {:else if hasEntries && !isToday && !isSelected}
                <span class="dot"></span>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  {#if deleteConfirm !== null}
    <div class="confirm-overlay" onclick={() => deleteConfirm = null}></div>
    <div class="confirm-dialog">
      <p>Delete this {deleteType}?</p>
      <p class="confirm-sub">This cannot be undone.</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={() => deleteConfirm = null}>Cancel</button>
        <button class="confirm-delete" onclick={deleteItem}>Delete</button>
      </div>
    </div>
  {/if}

  {#if showDateWarning}
    <div class="confirm-overlay" onclick={cancelDateWarning}></div>
    <div class="confirm-dialog">
      {#if dateWarningType === 'past'}
        <p>Adding entry for {formatDateDisplay(selectedDate)}</p>
        <p class="confirm-sub">This entry will be saved to {formatDateDisplay(selectedDate)}, not today ({formatDateDisplay(today())}).</p>
        <label class="skip-warning-label">
          <input type="checkbox" bind:checked={skipPastWarning} />
          Don't warn me about past dates
        </label>
      {:else}
        <p>Adding entry for {formatDateDisplay(selectedDate)}</p>
        <p class="confirm-sub">You're adding an entry for a future date. Are you sure?</p>
      {/if}
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={cancelDateWarning}>Cancel</button>
        <button class="confirm-add" onclick={confirmDateWarning}>Add Anyway</button>
      </div>
    </div>
  {/if}

  {#if showReactionForm}
    <div class="modal-overlay" onclick={() => showReactionForm = false}></div>
    <div class="modal">
      <h3>Log Reaction</h3>
      {#if reactionError}<div class="reaction-error">{reactionError}</div>{/if}
      <input bind:value={reactionSymptom} placeholder="Symptom (e.g. rash, bloating)" class="modal-input" oninput={() => reactionError = ''} />
      <div class="severity-row">
        <span>Severity:</span>
        {#each [1,2,3,4] as s}
          <button
            class="severity-btn"
            class:active={reactionSeverity === s}
            onclick={() => reactionSeverity = s}
          >{SEVERITY_LABELS[s]}</button>
        {/each}
      </div>
      <textarea bind:value={reactionNotes} placeholder="Notes (optional)" rows="2" class="modal-input"></textarea>
      <div class="modal-actions">
        <button class="confirm-cancel" onclick={() => showReactionForm = false}>Cancel</button>
        <button class="confirm-delete" onclick={addReaction}>Log</button>
      </div>
    </div>
  {/if}

  {#if showBarcode}
    <div class="modal-overlay" onclick={() => { showBarcode = false; }}></div>
    <div class="modal barcode-modal">
      <h3>Scan Barcode</h3>
      <BarcodeScanner bind:this={scannerComponent} onBarcode={handleBarcodeDetected} />
      <div class="manual-barcode-row">
        <input
          bind:value={manualBarcode}
          placeholder="Or type barcode number"
          type="text"
          inputmode="numeric"
          class="manual-barcode-input"
          onkeydown={(e) => { if (e.key === 'Enter' && manualBarcode.trim()) handleBarcodeDetected(manualBarcode.trim()); }}
        />
        <button
          class="manual-barcode-btn"
          disabled={!manualBarcode.trim() || isBusy}
          onclick={() => handleBarcodeDetected(manualBarcode.trim())}
        >Look Up</button>
      </div>
      {#if scannerStatus === 'looking_up'}
        <p class="not-found">Looking up product... ({barcodeElapsed}s)</p>
      {:else if scannerStatus === 'success' && scannedProduct}
        <div class="barcode-result">
          {#if scannedProduct.image}
            <img src={scannedProduct.image} alt={scannedProduct.name} class="barcode-product-img" />
          {/if}
          <strong>{scannedProduct.name}</strong>
          {#if scannedProduct.brand}<p>{scannedProduct.brand}</p>{/if}
          {#if scannedProduct.warnings?.length}
            <div class="allergen-warning-banner">
              ⚠️ Contains: {scannedProduct.warnings.join(', ')}
            </div>
          {/if}
          {#if scannedProduct.allergens?.length}
            <p class="allergens">Allergens: {scannedProduct.allergens.join(', ')}</p>
          {/if}
          <button class="submit" onclick={addBarcodeAsEntry}>Add to notes</button>
        </div>
      {:else if scannerStatus === 'error'}
        <p class="not-found" style="color:#c00">{errorMessage}</p>
        <button class="submit" style="margin-top:8px" onclick={() => { scannerComponent?.startScanner(); scannerStatus = 'idle'; }}>Try Again</button>
        <button class="submit" style="margin-top:8px" onclick={() => { text = `Scanned barcode: (unknown product)`; showBarcode = false; }}>Manual Entry</button>
      {/if}
    </div>
  {/if}

  {#if showFavorites}
    <div class="modal-overlay" onclick={() => showFavorites = false}></div>
    <div class="modal">
      <h3>Favorite Foods</h3>
      {#if favorites.length === 0}
        <p class="not-found">No favorites yet. Star an entry to save it.</p>
      {/if}
      {#each favorites as fav}
        <div class="fav-item">
          <div class="fav-text">
            <strong>{fav.text?.slice(0, 60) || 'Photo entry'}</strong>
            <small>Used {fav.use_count}x</small>
          </div>
          <div class="fav-actions">
            <button class="entry-btn" onclick={() => applyFavorite(fav)}>Use</button>
            <button class="entry-btn delete" onclick={() => deleteFavorite(fav.id)}>✕</button>
          </div>
        </div>
      {/each}
      <div class="modal-actions">
        <button class="confirm-cancel" onclick={() => showFavorites = false}>Close</button>
      </div>
    </div>
  {/if}

  {#if showTemplates}
    <div class="modal-overlay" onclick={() => showTemplates = false}></div>
    <div class="modal">
      <h3>Meal Templates</h3>
      {#if templates.length === 0}
        <p class="not-found">No templates saved yet.</p>
      {/if}
      {#each templates as tpl}
        <div class="fav-item">
          <div class="fav-text">
            <strong>{tpl.name}</strong>
            <small>{tpl.items?.split('\n').length || 0} items</small>
          </div>
          <div class="fav-actions">
            <button class="entry-btn" onclick={() => applyTemplate(tpl)}>Use</button>
            <button class="entry-btn delete" onclick={() => deleteTemplate(tpl.id)}>✕</button>
          </div>
        </div>
      {/each}
      <div class="modal-actions">
        <button class="confirm-cancel" onclick={() => showTemplates = false}>Close</button>
      </div>
    </div>
  {/if}

  {#if showSaveTemplate}
    <div class="modal-overlay" onclick={() => showSaveTemplate = false}></div>
    <div class="modal">
      <h3>Save as Template</h3>
      <input bind:value={templateName} placeholder="Template name" class="modal-input" />
      <div class="modal-actions">
        <button class="confirm-cancel" onclick={() => showSaveTemplate = false}>Cancel</button>
        <button class="confirm-delete" onclick={saveAsTemplate}>Save</button>
      </div>
    </div>
  {/if}

  <div class="date-header">
    <h2>{formatDateDisplay(selectedDate)}</h2>
  </div>

  <div class="actions">
    <button onclick={() => cameraInput.click()}>📷 Photo</button>
    <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={handlePhoto} hidden />
  </div>

  {#if imageBase64}
    <img src={imageBase64} alt="Preview" class="preview" />
  {/if}

  <textarea bind:value={text} placeholder="What did you eat?" rows="2"></textarea>

  <button class="submit" onclick={addEntry}>Add Entry</button>

  {#if entries.length > 0}
    <button class="template-save-btn" onclick={() => showSaveTemplate = true}>Save day as template</button>
  {/if}

  <div class="day-notes">
    <label>Day Notes</label>
    <textarea
      bind:value={dayNotes}
      placeholder="How are you feeling today? Any symptoms?"
      rows="2"
      onblur={saveDayNotes}
    ></textarea>
    {#if savingNotes}<span class="saving">Saving...</span>{/if}
  </div>

  <div class="entries">
    {#each MEALS as meal}
      {@const mealEntries = groupedEntries()[meal]}
      <div class="meal-section">
        <h3 class="meal-title">{meal}</h3>
        {#if mealEntries.length === 0}
          <div class="no-entries">No entries</div>
        {/if}
        {#each mealEntries as entry (entry.id)}
          {@const entryBd = entry.barcode_data ? JSON.parse(entry.barcode_data) : null}
          <div class="entry" class:entry-warning={entryBd?.warnings?.length}>
            <div class="entry-header">
              <div class="entry-time">{timeOnly(entry.created_at)}</div>
              <div class="entry-actions">
                <button class="entry-btn" onclick={() => favoriteEntry(entry)}>⭐</button>
                <button class="entry-btn" onclick={() => startEditEntry(entry)}>✎</button>
                <button class="entry-btn delete" onclick={() => { deleteConfirm = entry.id; deleteType = 'entry'; }}>✕</button>
              </div>
            </div>

            {#if editingEntry === entry.id}
              <div class="edit-row">
                <select bind:value={editMeal}>
                  {#each MEALS as m}
                    <option value={m}>{m}</option>
                  {/each}
                </select>
                <input type="time" bind:value={editTime} />
                <button class="edit-save" onclick={() => saveEditEntry(entry)}>Save</button>
                <button class="edit-cancel" onclick={() => editingEntry = null}>✕</button>
              </div>
            {:else}
              <span class="meal-badge">{entry.meal}</span>
            {/if}

            {#if entry.image}
              <img src={entry.image} alt="Food" class="entry-img" />
            {/if}
            {#if entry.barcode_data}
              {@const bd = JSON.parse(entry.barcode_data)}
              {#if bd.warnings?.length}
                <div class="entry-allergen-warning">⚠️ Contains: {bd.warnings.join(', ')}</div>
              {/if}
              {#if bd.image}
                <img src={bd.image} alt={bd.name || 'Product'} class="entry-img" />
              {/if}
              {#if bd.brand}
                <p class="entry-text" style="color:#666;font-size:12px;margin-bottom:2px">{bd.brand}</p>
              {/if}
              {#if bd.allergens?.length}
                <p class="entry-text" style="color:#c00;font-weight:600;font-size:12px;margin-bottom:2px">Allergens: {bd.allergens.join(', ')}</p>
              {/if}
              {#if bd.ingredients}
                <details class="ingredients-details">
                  <summary>Ingredients</summary>
                  <p class="entry-text" style="font-size:12px;color:#555;margin:4px 0 0">{bd.ingredients}</p>
                </details>
              {/if}
            {/if}
            {#if entry.text}
              <p class="entry-text">{entry.text}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  {#if reactions.length > 0}
    <div class="reactions-section">
      <h3 class="meal-title reaction-title">⚠️ Reactions</h3>
      {#each reactions as reaction (reaction.id)}
        <div class="entry reaction">
          <div class="entry-header">
            <div>
              <strong>{reaction.symptom}</strong>
              <span class="severity-badge s{reaction.severity}">{SEVERITY_LABELS[reaction.severity]}</span>
            </div>
            <div class="entry-actions">
              <button class="entry-btn delete" onclick={() => { deleteConfirm = reaction.id; deleteType = 'reaction'; }}>✕</button>
            </div>
          </div>
          <div class="entry-time">{timeOnly(reaction.created_at)}</div>
          {#if reaction.notes}
            <p class="entry-text">{reaction.notes}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  :global(html, body) { overflow-x: hidden; margin: 0; padding: 0; }
  main { max-width: 480px; margin: 0 auto; padding: 16px; position: relative; }
  h1 { margin: 0 0 8px; }
  h2 { margin: 0; font-size: 18px; }
  h3 { margin: 0; }

  header { display: flex; flex-direction: column; gap: 8px; }
  .header-left { display: flex; align-items: baseline; gap: 8px; }
  .username { font-size: 12px; color: #888; }
  .header-btns { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
  .icon-btn { background: none; border: none; font-size: 20px; padding: 4px 8px; cursor: pointer; border-radius: 8px; text-decoration: none; display: inline-flex; }
  .icon-btn:hover { background: #f0f0f0; }

  .date-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #eee; cursor: pointer;
  }
  .date-header h2 { color: #333; }

  .actions { display: flex; gap: 8px; margin-bottom: 12px; }
  button { padding: 10px 16px; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 14px; }
  .preview { width: 100%; border-radius: 8px; margin-bottom: 8px; }
  textarea, input[type="text"] { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #ccc; box-sizing: border-box; margin-bottom: 8px; font-family: inherit; font-size: 14px; }
  .submit { width: 100%; background: #000; color: #fff; margin-top: 4px; }

  .day-notes { margin: 16px 0; padding: 12px; background: #fffde7; border-radius: 8px; border: 1px solid #fff9c4; }
  .day-notes label { font-size: 12px; font-weight: 600; color: #666; display: block; margin-bottom: 4px; }
  .day-notes textarea { border-color: #fff9c4; background: #fff; margin-bottom: 0; }
  .saving { font-size: 11px; color: #888; }

  .meal-section { margin-bottom: 16px; }
  .meal-title { font-size: 14px; font-weight: 600; color: #4CAF50; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e8f5e9; }
  .no-entries { color: #ccc; font-size: 13px; padding: 4px 0; }

  .entry { border: 1px solid #eee; border-radius: 12px; padding: 10px; margin-bottom: 8px; background: #fafafa; }
  .entry.entry-warning { border-color: #ffcc80; background: #fff8e1; }
  .entry.reaction { border-color: #ffcdd2; background: #fff5f5; }
  .entry-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .entry-time { font-size: 12px; color: #888; }
  .entry-actions { display: flex; gap: 2px; }
  .entry-btn { background: none; border: none; padding: 2px 6px; cursor: pointer; font-size: 14px; color: #aaa; border-radius: 4px; }
  .entry-btn:hover { background: #eee; color: #333; }
  .entry-btn.delete:hover { color: #c00; background: #fee; }
  .meal-badge { font-size: 11px; color: #4CAF50; background: #e8f5e9; padding: 1px 6px; border-radius: 4px; }
  .entry-img { width: 100%; border-radius: 8px; margin: 6px 0; }
  .entry-text { margin: 4px 0 0; line-height: 1.4; font-size: 14px; white-space: pre-wrap; }
  .ingredients-details { margin: 4px 0 0; font-size: 12px; }
  .ingredients-details summary { cursor: pointer; color: #888; font-size: 11px; }
  .ingredients-details summary:hover { color: #4CAF50; }
  .allergen-warning-banner {
    background: #fff3e0; border: 1px solid #ffe0b2; color: #e65100;
    padding: 6px 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
    margin: 6px 0;
  }
  .entry-allergen-warning {
    background: #fff3e0; border: 1px solid #ffe0b2; color: #e65100;
    padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
    margin-bottom: 4px;
  }

  .edit-row { display: flex; gap: 4px; margin: 6px 0; align-items: center; }
  .edit-row select, .edit-row input { margin: 0; padding: 4px 6px; font-size: 13px; border: 1px solid #ccc; border-radius: 6px; }
  .edit-row select { flex: 1; }
  .edit-row input[type="time"] { flex: 1; }
  .edit-save { background: #4CAF50; color: #fff; border: none; padding: 4px 10px; font-size: 13px; }
  .edit-cancel { background: none; border: none; color: #888; padding: 4px 6px; font-size: 13px; }

  .severity-row { display: flex; gap: 4px; align-items: center; margin: 8px 0; font-size: 13px; }
  .severity-btn { padding: 4px 8px; font-size: 12px; border: 1px solid #ccc; background: #f5f5f5; }
  .severity-btn.active { background: #ff9800; color: #fff; border-color: #ff9800; }
  .severity-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  .severity-badge.s1 { background: #e8f5e9; color: #2e7d32; }
  .severity-badge.s2 { background: #fff3e0; color: #e65100; }
  .severity-badge.s3 { background: #fbe9e7; color: #c62828; }
  .severity-badge.s4 { background: #c62828; color: #fff; }

  .reactions-section { margin-top: 20px; }
  .reaction-title { color: #c00; border-bottom-color: #ffcdd2; }

  .day-notes { margin: 16px 0; padding: 12px; background: #fffde7; border-radius: 8px; border: 1px solid #fff9c4; }
  .day-notes label { font-size: 12px; font-weight: 600; color: #666; display: block; margin-bottom: 4px; }
  .day-notes textarea { border-color: #fff9c4; background: #fff; margin-bottom: 0; }

  .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 30; }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 16px; padding: 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 40;
    width: 320px; max-height: 80vh; overflow-y: auto;
  }
  .modal h3 { margin: 0 0 12px; }
  .modal-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; margin-bottom: 8px; font-family: inherit; font-size: 14px; }
  .modal-actions { display: flex; gap: 8px; margin-top: 12px; }
  .reaction-error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c00; padding: 8px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; }
  .barcode-modal { width: 340px; }
  .barcode-reader { width: 100%; margin-bottom: 12px; }
  .barcode-reader :global(video) { border-radius: 8px; }
  .barcode-result { margin-top: 12px; padding: 10px; background: #f5f5f5; border-radius: 8px; }
  .manual-barcode-row { display: flex; gap: 6px; margin-top: 10px; }
  .manual-barcode-input { flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: inherit; }
  .manual-barcode-btn {
    padding: 8px 12px; background: #333; color: #fff; border: none; border-radius: 8px;
    font-size: 13px; cursor: pointer; font-family: inherit; white-space: nowrap;
  }
  .manual-barcode-btn:disabled { opacity: 0.4; cursor: default; }
  .barcode-product-img { width: 100%; max-height: 160px; object-fit: contain; border-radius: 8px; margin-bottom: 8px; }
  .barcode-result .submit { margin-top: 8px; }
  .allergens { color: #c00; font-weight: 600; }
  .not-found { color: #888; text-align: center; }

  .fav-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 6px; background: #fafafa; }
  .fav-text { flex: 1; min-width: 0; }
  .fav-text strong { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fav-text small { color: #888; font-size: 11px; }
  .fav-actions { display: flex; gap: 2px; }

  .template-save-btn { width: 100%; margin-top: 6px; background: none; border: 1px dashed #ccc; color: #888; font-size: 13px; padding: 8px; }
  .template-save-btn:hover { border-color: #4CAF50; color: #4CAF50; }

  .confirm-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 50; }
  .confirm-dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 16px; padding: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 60;
    width: 280px; text-align: center;
  }
  .confirm-dialog p { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  .confirm-sub { color: #888; font-size: 14px !important; font-weight: 400 !important; margin-bottom: 16px !important; }
  .confirm-actions { display: flex; gap: 8px; }
  .confirm-cancel { flex: 1; background: #f5f5f5; }
  .confirm-delete { flex: 1; background: #c00; color: #fff; border-color: #c00; }
  .confirm-add { flex: 1; background: #4CAF50; color: #fff; border-color: #4CAF50; }
  .confirm-add:hover { background: #388E3C; }
  .skip-warning-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #666; margin-bottom: 16px; cursor: pointer; }
  .skip-warning-label input { margin: 0; }

  .calendar-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.3); z-index: 10; }
  .calendar {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 16px; padding: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 20; width: 300px;
  }
  .calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .calendar-header span { font-weight: 600; font-size: 16px; }
  .calendar-header button { border: none; background: none; font-size: 20px; padding: 4px 12px; }
  .today-btn { display: block; width: 100%; margin-bottom: 8px; padding: 6px; background: #4CAF50; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .today-btn:hover { background: #388E3C; }
  .calendar-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
  .day-label { font-size: 12px; color: #888; padding: 4px 0; font-weight: 600; }
  .day { padding: 8px 0; border-radius: 8px; border: none; background: none; cursor: pointer; font-size: 14px; position: relative; }
  .day.empty { cursor: default; }
  .day.today { font-weight: 700; color: #fff; background: #4CAF50; box-shadow: 0 2px 8px rgba(76,175,80,0.4); }
  .day.selected { background: #000; color: #fff; font-weight: 600; }
  .day.has-entries { background: #e8f5e9; font-weight: 500; }
  .day:hover:not(.empty):not(.selected):not(.today) { background: #eee; }
  .dot { display: block; width: 4px; height: 4px; border-radius: 50%; background: #4CAF50; margin: 2px auto 0; }
  .reaction-dot { display: block; width: 6px; height: 6px; border-radius: 50%; background: #c00; margin: 2px auto 0; }
</style>
