<script lang="ts">
  import { onMount } from 'svelte';

  interface Entry {
    id: number;
    text: string;
    image: string;
    created_at: string;
  }

  let entries: Entry[] = $state([]);
  let selectedDate = $state(new Date().toISOString().slice(0, 10));
  let showCalendar = $state(false);
  let calendarMonth = $state(new Date().getMonth());
  let calendarYear = $state(new Date().getFullYear());
  let text = $state('');
  let imageBase64 = $state('');
  let cameraInput: HTMLInputElement;
  let deleteConfirm: number | null = $state(null);
  let daysWithEntries: Set<string> = $state(new Set());

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function today() { return new Date().toISOString().slice(0, 10); }

  async function loadEntries(date: string) {
    const res = await fetch(`/api/entries?date=${date}`);
    entries = await res.json();
  }

  async function loadDaysWithEntries(year: number, month: number) {
    const results: Array<{ date: string }> = [];
    for (let day = 1; day <= getDaysInMonth(year, month); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const res = await fetch(`/api/entries?date=${dateStr}`);
      const data = await res.json();
      if (data.length > 0) results.push({ date: dateStr });
    }
    daysWithEntries = new Set(results.map(r => r.date));
  }

  onMount(() => {
    loadEntries(selectedDate);
    loadDaysWithEntries(calendarYear, calendarMonth);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
  });

  function selectDate(date: string) {
    selectedDate = date;
    showCalendar = false;
    loadEntries(date);
  }

  function goToToday() {
    const t = new Date();
    calendarMonth = t.getMonth();
    calendarYear = t.getFullYear();
    selectedDate = today();
    showCalendar = false;
    loadEntries(today());
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
    const d = new Date(dateStr + 'T00:00:00');
    const todayStr = today();
    if (dateStr === todayStr) return 'Today';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
    const { id } = await res.json();
    entries = [{ id, text, image: imageBase64, created_at: new Date().toISOString() }, ...entries];
    text = '';
    imageBase64 = '';
  }

  async function deleteEntry(id: number) {
    await fetch('/api/entries', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    entries = entries.filter(e => e.id !== id);
    deleteConfirm = null;
  }

  function timeOnly(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
    <h1>Food Tracker</h1>
    <button class="calendar-toggle" onclick={() => showCalendar = !showCalendar}>
      📅
    </button>
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
            <button
              class="day"
              class:today={isToday}
              class:selected={isSelected}
              class:has-entries={hasEntries && !isToday && !isSelected}
              onclick={() => selectDate(dateStr)}
            >
              {day}
              {#if hasEntries && !isToday && !isSelected}
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
      <p>Delete this entry?</p>
      <p class="confirm-sub">This cannot be undone.</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={() => deleteConfirm = null}>Cancel</button>
        <button class="confirm-delete" onclick={() => deleteEntry(deleteConfirm!)}>Delete</button>
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

  <textarea bind:value={text} placeholder="Notes..." rows="3"></textarea>

  <button class="submit" onclick={addEntry}>Add Entry</button>

  <div class="entries">
    {#each entries as entry (entry.id)}
      <div class="entry">
        <div class="entry-header">
          <div class="entry-time">{timeOnly(entry.created_at)}</div>
          <button class="entry-delete" onclick={() => deleteConfirm = entry.id}>✕</button>
        </div>
        {#if entry.image}
          <img src={entry.image} alt="Food" class="entry-img" />
        {/if}
        {#if entry.text}
          <p class="entry-text">{entry.text}</p>
        {/if}
      </div>
    {/each}
    {#if entries.length === 0}
      <div class="empty-state">No entries for this day</div>
    {/if}
  </div>
</main>

<style>
  main { max-width: 480px; margin: 0 auto; padding: 16px; position: relative; }
  h1 { margin: 0 0 8px; }
  h2 { margin: 0; font-size: 18px; }

  header { display: flex; justify-content: space-between; align-items: center; }

  .date-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #eee;
    cursor: pointer;
  }
  .date-header h2 { color: #333; }

  .actions { display: flex; gap: 8px; margin-bottom: 12px; }
  button { padding: 10px 16px; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 14px; }
  .preview { width: 100%; border-radius: 8px; margin-bottom: 8px; }
  textarea { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #ccc; box-sizing: border-box; margin-bottom: 8px; font-family: inherit; }
  .submit { width: 100%; background: #000; color: #fff; }

  .entries { margin-top: 24px; }
  .entry {
    border: 1px solid #eee;
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 12px;
    background: #fafafa;
  }
  .entry-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .entry-time { font-size: 12px; color: #888; }
  .entry-delete {
    background: none; border: none; color: #ccc; font-size: 16px;
    padding: 2px 6px; cursor: pointer; border-radius: 4px;
  }
  .entry-delete:hover { color: #c00; background: #fee; }
  .entry-img { width: 100%; border-radius: 8px; }
  .entry-text { margin: 8px 0 0; line-height: 1.4; }
  .empty-state { text-align: center; color: #aaa; padding: 32px 0; }

  .confirm-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 30;
  }
  .confirm-dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 16px; padding: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 40;
    width: 280px; text-align: center;
  }
  .confirm-dialog p { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  .confirm-sub { color: #888; font-size: 14px !important; font-weight: 400 !important; margin-bottom: 16px !important; }
  .confirm-actions { display: flex; gap: 8px; }
  .confirm-cancel { flex: 1; background: #f5f5f5; }
  .confirm-delete { flex: 1; background: #c00; color: #fff; border-color: #c00; }

  .calendar-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3); z-index: 10;
  }
  .calendar {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 16px; padding: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 20;
    width: 300px;
  }
  .calendar-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px;
  }
  .calendar-header span { font-weight: 600; font-size: 16px; }
  .calendar-header button { border: none; background: none; font-size: 20px; padding: 4px 12px; }
  .today-btn {
    display: block; width: 100%; margin-bottom: 8px; padding: 6px;
    background: #4CAF50; color: #fff; border: none; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .today-btn:hover { background: #388E3C; }
  .calendar-days {
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
    text-align: center;
  }
  .day-label { font-size: 12px; color: #888; padding: 4px 0; font-weight: 600; }
  .day {
    padding: 8px 0; border-radius: 8px; border: none; background: none;
    cursor: pointer; font-size: 14px; position: relative;
  }
  .day.empty { cursor: default; }
  .day.today {
    font-weight: 700; color: #fff; background: #4CAF50;
    box-shadow: 0 2px 8px rgba(76,175,80,0.4);
  }
  .day.selected { background: #000; color: #fff; font-weight: 600; }
  .day.has-entries { background: #e8f5e9; font-weight: 500; }
  .day:hover:not(.empty):not(.selected):not(.today) { background: #eee; }
  .dot {
    display: block; width: 4px; height: 4px; border-radius: 50%;
    background: #4CAF50; margin: 2px auto 0;
  }
</style>
