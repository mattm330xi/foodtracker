<script lang="ts">
  import { onMount } from 'svelte';

  interface Entry {
    id: number;
    text: string;
    image: string;
    meal: string;
    created_at: string;
    day_notes: string;
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

  // Reaction form
  let showReactionForm = $state(false);
  let reactionSymptom = $state('');
  let reactionSeverity = $state(1);
  let reactionNotes = $state('');

  // Barcode
  let showBarcode = $state(false);
  let barcodeInput = $state('');
  let barcodeResult: any = $state(null);
  let barcodeLoading = $state(false);
  let barcodeInputEl: HTMLInputElement;

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

  function selectDate(date: string) {
    selectedDate = date;
    showCalendar = false;
    loadEntries(date);
    loadReactions(date);
    loadDayNotes(date);
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
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image: imageBase64 })
    });
    const { id, meal } = await res.json();
    entries = [...entries, { id, text, image: imageBase64, meal, created_at: new Date().toISOString(), day_notes: '' }];
    text = '';
    imageBase64 = '';
  }

  async function updateEntry(id: number, field: string, value: string) {
    await fetch('/api/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value })
    });
    entries = entries.map(e => e.id === id ? { ...e, [field]: value } : e);
  }

  function startEditEntry(entry: Entry) {
    editingEntry = entry.id;
    editMeal = entry.meal;
    const d = new Date(entry.created_at);
    const hours = parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }));
    const minutes = parseInt(d.toLocaleString('en-US', { minute: 'numeric', timeZone: timezone }));
    editTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function saveEditEntry(entry: Entry) {
    const [h, m] = editTime.split(':');
    // Create a date in the user's timezone and convert to UTC
    const d = new Date(entry.created_at);
    const localStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    const tzDate = new Date(`${localStr}T${editTime}:00`);
    // Get the offset for this timezone
    const utcStr = tzDate.toLocaleString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: 'numeric', hour12: false });
    const localStr2 = tzDate.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false });
    const [utcH, utcM] = utcStr.split(':').map(Number);
    const [localH, localM] = localStr2.split(':').map(Number);
    const diffMinutes = (localH * 60 + localM) - (utcH * 60 + utcM);
    const utcDate = new Date(tzDate.getTime() - diffMinutes * 60 * 1000);
    const newIso = utcDate.toISOString();
    updateEntry(entry.id, 'meal', editMeal);
    updateEntry(entry.id, 'created_at', newIso);
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
    if (!reactionSymptom) return;
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symptom: reactionSymptom, severity: reactionSeverity, notes: reactionNotes })
    });
    const { id } = await res.json();
    reactions = [...reactions, { id, symptom: reactionSymptom, severity: reactionSeverity, notes: reactionNotes, created_at: new Date().toISOString() }];
    reactionSymptom = '';
    reactionSeverity = 1;
    reactionNotes = '';
    showReactionForm = false;
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

  async function lookupBarcode() {
    if (!barcodeInput) return;
    barcodeLoading = true;
    barcodeResult = null;
    const res = await fetch(`/api/barcode?barcode=${barcodeInput}`);
    barcodeResult = await res.json();
    barcodeLoading = false;
  }

  function addBarcodeAsEntry() {
    if (!barcodeResult) return;
    const notes = [
      barcodeResult.name,
      barcodeResult.brand ? `Brand: ${barcodeResult.brand}` : '',
      barcodeResult.ingredients ? `Ingredients: ${barcodeResult.ingredients}` : '',
      barcodeResult.allergens?.length ? `Allergens: ${barcodeResult.allergens.join(', ')}` : ''
    ].filter(Boolean).join('\n');
    text = notes;
    showBarcode = false;
    barcodeResult = null;
    barcodeInput = '';
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
      <button class="icon-btn" onclick={() => showBarcode = true}>📊</button>
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

  {#if showReactionForm}
    <div class="modal-overlay" onclick={() => showReactionForm = false}></div>
    <div class="modal">
      <h3>Log Reaction</h3>
      <input bind:value={reactionSymptom} placeholder="Symptom (e.g. rash, bloating)" class="modal-input" />
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
    <div class="modal-overlay" onclick={() => { showBarcode = false; barcodeResult = null; }}></div>
    <div class="modal">
      <h3>Barcode Lookup</h3>
      <div class="barcode-row">
        <input bind:this={barcodeInputEl} bind:value={barcodeInput} placeholder="Enter or scan barcode" class="modal-input" />
        <button class="submit" onclick={lookupBarcode} disabled={barcodeLoading}>
          {barcodeLoading ? '...' : 'Look up'}
        </button>
      </div>
      {#if barcodeResult?.found}
        <div class="barcode-result">
          <strong>{barcodeResult.name}</strong>
          {#if barcodeResult.brand}<p>{barcodeResult.brand}</p>{/if}
          {#if barcodeResult.allergens?.length}
            <p class="allergens">Allergens: {barcodeResult.allergens.join(', ')}</p>
          {/if}
          <button class="submit" onclick={addBarcodeAsEntry}>Add to notes</button>
        </div>
      {:else if barcodeResult && !barcodeResult.found}
        <p class="not-found">Product not found</p>
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
          <div class="entry">
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
  main { max-width: 480px; margin: 0 auto; padding: 16px; position: relative; }
  h1 { margin: 0 0 8px; }
  h2 { margin: 0; font-size: 18px; }
  h3 { margin: 0; }

  header { display: flex; justify-content: space-between; align-items: center; }
  .header-left { display: flex; align-items: baseline; gap: 8px; }
  .username { font-size: 12px; color: #888; }
  .header-btns { display: flex; gap: 4px; }
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
  .barcode-row { display: flex; gap: 8px; }
  .barcode-row .modal-input { flex: 1; margin: 0; }
  .barcode-row .submit { width: auto; margin: 0; padding: 8px 16px; }
  .barcode-result { margin-top: 12px; padding: 10px; background: #f5f5f5; border-radius: 8px; }
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
