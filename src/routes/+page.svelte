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
  const MEAL_EMPTY_STATE: Record<string, { icon: string; prompt: string }> = {
    Breakfast: { icon: '🍳', prompt: 'Add your first breakfast' },
    Lunch: { icon: '🥪', prompt: 'Log what you had for lunch' },
    Dinner: { icon: '🍽️', prompt: "Log tonight's dinner" },
    Snacks: { icon: '🍪', prompt: 'Track a snack' },
  };

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
  let dayEntryCounts: Map<string, number> = $state(new Map());
  let editingEntry: number | null = $state(null);
  let editMeal: string = $state('');
  let editTime: string = $state('');
  let editText: string = $state('');
  let dayNotes: string = $state('');
  let savingNotes = $state(false);
  let dayNotesExpanded = $state(false);

  // Date warning
  let showDateWarning = $state(false);
  let showEmptyEntryPrompt = $state(false);
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
  let barcodeMode: 'scan' | 'manual' = $state('scan');
  let manualBarcodeInput: HTMLInputElement | null = $state(null);
  const BARCODE_TIMEOUT_MS = 5000;

  function setBarcodeMode(mode: 'scan' | 'manual') {
    if (mode === barcodeMode) return;
    barcodeMode = mode;
    if (mode === 'manual') {
      scannerComponent?.stopScanner();
      tick().then(() => manualBarcodeInput?.focus());
    } else {
      tick().then(() => scannerComponent?.startScanner());
    }
  }

  // Favorites
  let favorites: any[] = $state([]);

  // Templates
  let templates: any[] = $state([]);
  let templateName = $state('');
  let showSaveTemplate = $state(false);

  // Quick Add (Favorites / Templates / Repeat Yesterday)
  let showQuickAdd = $state(false);
  let quickAddTab: 'favorites' | 'templates' | 'repeat' = $state('favorites');
  let yesterdayEntries: any[] = $state([]);
  let yesterdayLoaded = false;

  function yesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: timezone });
  }

  async function loadYesterdayEntries() {
    if (yesterdayLoaded) return;
    const res = await fetch(`/api/entries?date=${yesterdayDateStr()}`);
    yesterdayEntries = await res.json();
    yesterdayLoaded = true;
  }

  function setQuickAddTab(tab: 'favorites' | 'templates' | 'repeat') {
    quickAddTab = tab;
    if (tab === 'repeat') loadYesterdayEntries();
  }

  async function quickAddYesterdayEntry(entry: any) {
    text = entry.text || '';
    imageBase64 = entry.image || '';
    showQuickAdd = false;
    await addEntry();
  }

  // View preferences
  let horizontalScroll = $state(false);

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
    dayNotesExpanded = !!dayNotes;
  }

  async function loadDaysWithEntries(year: number, month: number) {
    const eSet = new Set<string>();
    const rSet = new Set<string>();
    const counts = new Map<string, number>();
    for (let day = 1; day <= getDaysInMonth(year, month); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const [eRes, rRes] = await Promise.all([
        fetch(`/api/entries?date=${dateStr}`),
        fetch(`/api/reactions?date=${dateStr}`)
      ]);
      const eData = await eRes.json();
      const rData = await rRes.json();
      if (eData.length > 0) { eSet.add(dateStr); counts.set(dateStr, eData.length); }
      if (rData.length > 0) rSet.add(dateStr);
    }
    daysWithEntries = eSet;
    daysWithReactions = rSet;
    dayEntryCounts = counts;
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
    const savedScrollPref = localStorage.getItem('ft_horizontalScroll');
    horizontalScroll = savedScrollPref !== null
      ? savedScrollPref === 'true'
      : window.matchMedia('(max-width: 700px)').matches;

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
      barcodeMode = 'scan';
      manualBarcode = '';
      tick().then(() => scannerComponent?.startScanner());
      return () => { scannerComponent?.stopScanner(); };
    }
  });

  onDestroy(() => {
    if (barcodeTimer) { clearInterval(barcodeTimer); barcodeTimer = null; }
  });

  // Svelte action: drag the sheet-handle down to dismiss its parent bottom sheet.
  function dragToDismiss(node: HTMLElement, onClose: () => void) {
    const DISMISS_THRESHOLD = 80;
    const sheet = node.closest('.modal, .calendar') as HTMLElement | null;
    let startY = 0;
    let currentY = 0;
    let dragging = false;

    function onTouchStart(e: TouchEvent) {
      dragging = true;
      startY = e.touches[0].clientY;
      currentY = startY;
      if (sheet) sheet.style.transition = 'none';
    }

    function onTouchMove(e: TouchEvent) {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      const dy = Math.max(0, currentY - startY);
      if (sheet) sheet.style.transform = `translateY(${dy}px)`;
    }

    function onTouchEnd() {
      if (!dragging) return;
      dragging = false;
      const dy = currentY - startY;
      if (sheet) {
        sheet.style.transition = '';
        sheet.style.transform = '';
      }
      if (dy > DISMISS_THRESHOLD) onClose();
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('touchend', onTouchEnd);

    return {
      update(newOnClose: () => void) { onClose = newOnClose; },
      destroy() {
        node.removeEventListener('touchstart', onTouchStart);
        node.removeEventListener('touchmove', onTouchMove);
        node.removeEventListener('touchend', onTouchEnd);
      }
    };
  }

  function selectDate(date: string) {
    selectedDate = date;
    showCalendar = false;
    showDateWarning = false;
    pendingAddFn = null;
    loadEntries(date);
    loadReactions(date);
    loadDayNotes(date);
  }

  function shiftDay(delta: number) {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const newDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (d.getMonth() !== calendarMonth || d.getFullYear() !== calendarYear) {
      calendarMonth = d.getMonth();
      calendarYear = d.getFullYear();
      loadDaysWithEntries(calendarYear, calendarMonth);
    }
    selectDate(newDate);
  }

  let dateSwipeStartX = 0;
  let dateSwipeStartY = 0;
  let dateSwipeActive = false;

  function onDateTouchStart(e: TouchEvent) {
    dateSwipeStartX = e.touches[0].clientX;
    dateSwipeStartY = e.touches[0].clientY;
    dateSwipeActive = true;
  }

  function onDateTouchEnd(e: TouchEvent) {
    if (!dateSwipeActive) return;
    dateSwipeActive = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - dateSwipeStartX;
    const dy = touch.clientY - dateSwipeStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftDay(dx < 0 ? 1 : -1);
    }
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
    if (!text && !imageBase64) {
      showEmptyEntryPrompt = true;
      return;
    }
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

  function chooseEmptyEntryPhoto() {
    showEmptyEntryPrompt = false;
    cameraInput.click();
  }

  function chooseEmptyEntryBarcode() {
    showEmptyEntryPrompt = false;
    showBarcode = true;
  }

  function startEditEntry(entry: Entry) {
    editingEntry = entry.id;
    editMeal = entry.meal;
    editText = entry.text || '';
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
      body: JSON.stringify({ id: entry.id, meal: editMeal, created_at: newIso, text: editText })
    });
    if (!res.ok) {
      alert('Failed to save changes. Please try again.');
      return;
    }
    entries = entries.map(e => e.id === entry.id ? { ...e, meal: editMeal, created_at: newIso, text: editText } : e);
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

  function isFavorited(entry: Entry): boolean {
    return entry.text ? favorites.some((f: any) => f.text === entry.text) : false;
  }

  async function toggleFavorite(entry: Entry) {
    if (!entry.text && !entry.image) return;
    const existing = favorites.find((f: any) => f.text === entry.text);
    if (existing) {
      await fetch('/api/favorites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existing.id })
      });
      favorites = favorites.filter((f: any) => f.id !== existing.id);
    } else {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.text, image: entry.image, meal: entry.meal })
      });
      loadFavorites();
    }
  }

  async function applyFavorite(fav: any) {
    text = fav.text || '';
    imageBase64 = fav.image || '';
    showQuickAdd = false;
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
    showQuickAdd = false;
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
      <a href="/stats" class="icon-btn btn-press" title="Stats" aria-label="Stats">
        <span class="icon-glyph">📈</span><span class="icon-label">Stats</span>
      </a>
      <button class="icon-btn btn-press" onclick={() => showQuickAdd = true} title="Quick add" aria-label="Quick add">
        <span class="icon-glyph">⭐</span><span class="icon-label">Quick Add</span>
      </button>
      <button class="icon-btn btn-press" onclick={() => showBarcode = true} title="Scan barcode" aria-label="Scan barcode">
        <span class="icon-glyph"><svg width="18" height="18" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="2" height="16" fill="currentColor"/><rect x="5" y="2" width="1" height="16" fill="currentColor"/><rect x="8" y="2" width="3" height="16" fill="currentColor"/><rect x="13" y="2" width="1" height="16" fill="currentColor"/><rect x="16" y="2" width="1" height="16" fill="currentColor"/></svg></span><span class="icon-label">Scan</span>
      </button>
      <button class="icon-btn btn-press" onclick={() => showReactionForm = true} title="Log reaction" aria-label="Log reaction">
        <span class="icon-glyph">⚠️</span><span class="icon-label">Reaction</span>
      </button>
      <button class="icon-btn btn-press" onclick={() => showCalendar = !showCalendar} title="Calendar" aria-label="Calendar" class:active={showCalendar}>
        <span class="icon-glyph">📅</span><span class="icon-label">Calendar</span>
      </button>
      <a href="/profile" class="icon-btn btn-press" title="Settings" aria-label="Settings">
        <span class="icon-glyph">⚙️</span><span class="icon-label">Settings</span>
      </a>
    </div>
  </header>

  {#if showCalendar}
    <div class="calendar-overlay" onclick={() => showCalendar = false}></div>
    <div class="calendar">
      <div class="sheet-handle" use:dragToDismiss={() => showCalendar = false}></div>
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
            {@const entryCount = dayEntryCounts.get(dateStr) || 0}
            {@const heatLevel = entryCount === 0 ? 0 : entryCount <= 2 ? 1 : entryCount <= 4 ? 2 : 3}
            <button
              class="day"
              class:today={isToday}
              class:selected={isSelected}
              class:heat-1={heatLevel === 1 && !isToday && !isSelected}
              class:heat-2={heatLevel === 2 && !isToday && !isSelected}
              class:heat-3={heatLevel === 3 && !isToday && !isSelected}
              onclick={() => selectDate(dateStr)}
              title={entryCount > 0 ? `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}` : undefined}
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

  {#if showEmptyEntryPrompt}
    <div class="confirm-overlay" onclick={() => showEmptyEntryPrompt = false}></div>
    <div class="confirm-dialog">
      <p>Nothing to add yet</p>
      <p class="confirm-sub">Add a photo or scan a barcode to log this entry.</p>
      <div class="empty-entry-actions">
        <button class="empty-entry-btn btn-press" onclick={chooseEmptyEntryPhoto}>📷 Add Photo</button>
        <button class="empty-entry-btn btn-press" onclick={chooseEmptyEntryBarcode}>
          <svg width="16" height="16" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="2" height="16" fill="currentColor"/><rect x="5" y="2" width="1" height="16" fill="currentColor"/><rect x="8" y="2" width="3" height="16" fill="currentColor"/><rect x="13" y="2" width="1" height="16" fill="currentColor"/><rect x="16" y="2" width="1" height="16" fill="currentColor"/></svg>
          Scan Barcode
        </button>
      </div>
      <button class="confirm-cancel btn-press" style="width:100%;margin-top:8px" onclick={() => showEmptyEntryPrompt = false}>Cancel</button>
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
      <div class="sheet-handle" use:dragToDismiss={() => showReactionForm = false}></div>
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
    <div class="popover barcode-popover">
      <div class="popover-header">
        <h3>Scan Barcode</h3>
        <button class="popover-close btn-press" onclick={() => showBarcode = false} aria-label="Close">&times;</button>
      </div>

      <div class="segmented-tabs">
        <button class="segmented-tab btn-press" class:active={barcodeMode === 'scan'} onclick={() => setBarcodeMode('scan')}>📷 Camera</button>
        <button class="segmented-tab btn-press" class:active={barcodeMode === 'manual'} onclick={() => setBarcodeMode('manual')}>⌨️ Type Number</button>
      </div>

      {#if barcodeMode === 'scan'}
        <BarcodeScanner bind:this={scannerComponent} onBarcode={handleBarcodeDetected} />
        <p class="scan-hint">Center the barcode in the frame</p>
      {:else}
        <div class="manual-barcode-panel">
          <label for="manual-barcode-input" class="manual-label">Barcode number</label>
          <div class="manual-barcode-row">
            <input
              id="manual-barcode-input"
              bind:this={manualBarcodeInput}
              bind:value={manualBarcode}
              placeholder="e.g. 0123456789012"
              type="text"
              inputmode="numeric"
              class="manual-barcode-input"
              onkeydown={(e) => { if (e.key === 'Enter' && manualBarcode.trim()) handleBarcodeDetected(manualBarcode.trim()); }}
            />
            <button
              class="manual-barcode-btn btn-press"
              disabled={!manualBarcode.trim() || isBusy}
              onclick={() => handleBarcodeDetected(manualBarcode.trim())}
            >Look Up</button>
          </div>
        </div>
      {/if}

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
        <p class="not-found" style="color:var(--danger)">{errorMessage}</p>
        <button class="submit btn-press" style="margin-top:8px" onclick={() => { scannerComponent?.startScanner(); scannerStatus = 'idle'; }}>Try Again</button>
        <button class="submit btn-press" style="margin-top:8px" onclick={() => { text = `Scanned barcode: (unknown product)`; showBarcode = false; }}>Log without product info</button>
      {/if}
    </div>
  {/if}

  {#if showQuickAdd}
    <div class="modal-overlay" onclick={() => showQuickAdd = false}></div>
    <div class="modal">
      <div class="sheet-handle" use:dragToDismiss={() => showQuickAdd = false}></div>
      <h3>Quick Add</h3>
      <div class="segmented-tabs">
        <button class="segmented-tab btn-press" class:active={quickAddTab === 'favorites'} onclick={() => setQuickAddTab('favorites')}>⭐ Favorites</button>
        <button class="segmented-tab btn-press" class:active={quickAddTab === 'templates'} onclick={() => setQuickAddTab('templates')}>📋 Templates</button>
        <button class="segmented-tab btn-press" class:active={quickAddTab === 'repeat'} onclick={() => setQuickAddTab('repeat')}>🔁 Yesterday</button>
      </div>

      {#if quickAddTab === 'favorites'}
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
              <button class="entry-btn btn-press" onclick={() => applyFavorite(fav)}>Use</button>
              <button class="entry-btn delete btn-press" onclick={() => deleteFavorite(fav.id)}>✕</button>
            </div>
          </div>
        {/each}
      {:else if quickAddTab === 'templates'}
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
              <button class="entry-btn btn-press" onclick={() => applyTemplate(tpl)}>Use</button>
              <button class="entry-btn delete btn-press" onclick={() => deleteTemplate(tpl.id)}>✕</button>
            </div>
          </div>
        {/each}
      {:else}
        {#if yesterdayEntries.length === 0}
          <p class="not-found">No entries logged yesterday.</p>
        {/if}
        {#each yesterdayEntries as ye}
          <div class="fav-item">
            <div class="fav-text">
              <strong>{ye.text?.slice(0, 60) || 'Photo entry'}</strong>
              <small>{ye.meal}</small>
            </div>
            <div class="fav-actions">
              <button class="entry-btn btn-press" onclick={() => quickAddYesterdayEntry(ye)}>+ Add</button>
            </div>
          </div>
        {/each}
      {/if}

      <div class="modal-actions">
        <button class="confirm-cancel btn-press" onclick={() => showQuickAdd = false}>Close</button>
      </div>
    </div>
  {/if}

  {#if showSaveTemplate}
    <div class="modal-overlay" onclick={() => showSaveTemplate = false}></div>
    <div class="modal">
      <div class="sheet-handle" use:dragToDismiss={() => showSaveTemplate = false}></div>
      <h3>Save as Template</h3>
      <input bind:value={templateName} placeholder="Template name" class="modal-input" />
      <div class="modal-actions">
        <button class="confirm-cancel" onclick={() => showSaveTemplate = false}>Cancel</button>
        <button class="confirm-delete" onclick={saveAsTemplate}>Save</button>
      </div>
    </div>
  {/if}

  <div class="date-header">
    <button class="day-nav-btn btn-press" onclick={() => shiftDay(-1)} aria-label="Previous day">‹</button>
    <h2
      class="date-header-title"
      ontouchstart={onDateTouchStart}
      ontouchend={onDateTouchEnd}
    >{formatDateDisplay(selectedDate)}</h2>
    <button class="day-nav-btn btn-press" onclick={() => shiftDay(1)} aria-label="Next day">›</button>
  </div>

  <div class="actions">
    <button onclick={() => cameraInput.click()}>📷 Photo</button>
    <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={handlePhoto} hidden />
  </div>

  {#if imageBase64}
    <img src={imageBase64} alt="Preview" class="preview" />
  {/if}

  <textarea bind:value={text} placeholder="Describe your photo, what did you eat?" rows="2"></textarea>

  <button class="submit" onclick={addEntry}>Add Entry</button>

  {#if entries.length > 0}
    <button class="template-save-btn" onclick={() => showSaveTemplate = true}>Save day as template</button>
  {/if}

  {#if dayNotesExpanded || dayNotes}
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
  {:else}
    <button class="day-notes-collapsed btn-press" onclick={() => dayNotesExpanded = true}>
      <span>📝</span> Add day notes (symptoms, how you're feeling)
    </button>
  {/if}

  <div class="entries">
    {#each MEALS as meal}
      {@const mealEntries = groupedEntries()[meal]}
      <div class="meal-section">
        <h3 class="meal-title">{meal}</h3>
        <div class="meal-entries" class:meal-entries-hscroll={horizontalScroll}>
        {#if mealEntries.length === 0}
          <div class="no-entries">
            <span class="no-entries-icon">{MEAL_EMPTY_STATE[meal].icon}</span>
            <span>{MEAL_EMPTY_STATE[meal].prompt}</span>
          </div>
        {/if}
        {#each mealEntries as entry (entry.id)}
          {@const entryBd = entry.barcode_data ? JSON.parse(entry.barcode_data) : null}
          <div class="entry" class:entry-warning={entryBd?.warnings?.length}>
            <div class="entry-header">
              <div class="entry-time">{timeOnly(entry.created_at)}</div>
              <div class="entry-actions">
                <button class="entry-btn star" class:star-active={isFavorited(entry)} onclick={() => toggleFavorite(entry)} aria-label={isFavorited(entry) ? 'Remove favorite' : 'Add favorite'}>⭐</button>
                <button class="entry-btn edit" onclick={() => startEditEntry(entry)} aria-label="Edit entry">✎</button>
                <button class="entry-btn delete" onclick={() => { deleteConfirm = entry.id; deleteType = 'entry'; }}>✕</button>
              </div>
            </div>

            {#if editingEntry === entry.id}
              <div class="edit-form">
                <textarea class="edit-text" bind:value={editText} placeholder="Note" rows="2"></textarea>
                <div class="edit-row">
                  <select bind:value={editMeal}>
                    {#each MEALS as m}
                      <option value={m}>{m}</option>
                    {/each}
                  </select>
                  <input type="time" bind:value={editTime} />
                  <button class="edit-save btn-press" onclick={() => saveEditEntry(entry)}>Save</button>
                  <button class="edit-cancel btn-press" onclick={() => editingEntry = null}>✕</button>
                </div>
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
                <p class="entry-text" style="color:var(--text-secondary);font-size:12px;margin-bottom:2px">{bd.brand}</p>
              {/if}
              {#if bd.allergens?.length}
                <p class="entry-text" style="color:var(--danger);font-weight:600;font-size:12px;margin-bottom:2px">Allergens: {bd.allergens.join(', ')}</p>
              {/if}
              {#if bd.ingredients}
                <details class="ingredients-details">
                  <summary>Ingredients</summary>
                  <p class="entry-text" style="font-size:12px;color:var(--text-secondary);margin:4px 0 0">{bd.ingredients}</p>
                </details>
              {/if}
            {/if}
            {#if entry.text && editingEntry !== entry.id}
              <p class="entry-text">{entry.text}</p>
            {/if}
          </div>
        {/each}
        </div>
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
  main { max-width: 560px; margin: 0 auto; padding: 16px 16px 32px; position: relative; }
  h2 { margin: 0; font-size: 16px; color: var(--text-primary); text-transform: none; letter-spacing: -0.01em; }

  header { display: flex; flex-direction: column; gap: 8px; }
  .header-left { display: flex; align-items: baseline; gap: 8px; }
  .username { font-size: 12px; color: var(--text-secondary); }
  .header-btns {
    display: flex; flex-wrap: wrap; gap: 4px; justify-content: center;
    background: var(--muted-bg); border-radius: var(--radius-lg);
    padding: 6px; box-shadow: var(--shadow-xs);
  }
  .icon-btn {
    background: var(--surface); border: none; color: var(--text-primary);
    text-decoration: none; display: inline-flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 2px;
    width: 56px; padding: 8px 4px 6px; border-radius: var(--radius-md);
    box-shadow: var(--shadow-xs); transition: background 0.15s, box-shadow 0.15s;
  }
  .icon-btn:hover { background: var(--primary-bg); }
  .icon-btn.active { background: var(--primary-bg); box-shadow: inset 0 0 0 1.5px var(--primary); }
  .icon-glyph { font-size: 19px; line-height: 1; display: inline-flex; }
  .icon-label { font-size: 9px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.02em; }

  .date-header {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  .date-header-title { flex: 1; text-align: center; touch-action: pan-y; user-select: none; }
  .day-nav-btn {
    background: var(--muted-bg); border: none; color: var(--text-secondary);
    font-size: 20px; line-height: 1; width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .day-nav-btn:hover { background: var(--primary-bg); color: var(--primary-dark); }

  .actions { display: flex; gap: 8px; margin-bottom: 12px; }
  button { padding: 10px 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--muted-bg); cursor: pointer; font-size: 14px; transition: transform 0.1s, opacity 0.1s, background 0.15s; }
  button:active { transform: scale(0.97); opacity: 0.85; }
  .preview { width: 100%; border-radius: var(--radius-md); margin-bottom: 8px; }
  textarea, input[type="text"] { width: 100%; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); box-sizing: border-box; margin-bottom: 8px; font-size: 15px; background: var(--surface); color: var(--text-primary); transition: border-color 0.15s; }
  textarea:focus, input[type="text"]:focus { outline: none; border-color: var(--primary); }
  .submit { width: 100%; background: var(--text-primary); color: var(--bg); border: none; font-weight: 600; margin-top: 4px; }

  .day-notes { margin: 16px 0; padding: 12px; background: var(--warning-bg); border-radius: var(--radius-md); border: 1px solid var(--warning-border); }
  .day-notes-collapsed {
    display: flex; align-items: center; gap: 8px; width: 100%; margin: 16px 0;
    padding: 10px 12px; background: var(--muted-bg); border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md); color: var(--text-secondary); font-size: 13px; text-align: left;
  }
  .day-notes-collapsed:hover { border-color: var(--warning); color: var(--text-primary); }
  .day-notes label { font-size: 12px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 4px; }
  .day-notes textarea { border-color: var(--warning-border); background: var(--surface); margin-bottom: 0; }
  .saving { font-size: 11px; color: var(--text-tertiary); }

  .meal-section { margin-bottom: 16px; }
  .meal-entries-hscroll { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 8px; }
  .meal-entries-hscroll .entry { flex: 0 0 260px; scroll-snap-align: start; margin-bottom: 0; }
  .meal-entries-hscroll .no-entries { flex: 0 0 auto; }
  .meal-title { font-size: 13px; font-weight: 600; color: var(--primary); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--primary-bg); }
  .no-entries { display: flex; align-items: center; gap: 8px; color: var(--text-tertiary); font-size: 13px; padding: 10px 0; }
  .no-entries-icon { font-size: 20px; opacity: 0.7; }

  .entry { background: var(--surface); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px; box-shadow: var(--shadow-sm); transition: transform 0.1s, box-shadow 0.2s; }
  .entry:active { transform: scale(0.99); }
  .entry.entry-warning { background: var(--warning-bg); box-shadow: none; }
  .entry.reaction { background: var(--danger-bg); box-shadow: none; }
  .entry-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .entry-time { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  .entry-actions { display: flex; gap: 2px; }
  .entry-btn { background: none; border: none; padding: 4px 6px; cursor: pointer; font-size: 14px; color: var(--text-tertiary); border-radius: var(--radius-xs); transition: color 0.15s, background 0.15s; }
  .entry-btn:hover { background: var(--border); color: var(--text-primary); }
  .entry-btn.star { filter: grayscale(1); opacity: 0.55; }
  .entry-btn.star:hover { opacity: 0.8; }
  .entry-btn.star-active { filter: none; opacity: 1; }
  .entry-btn.edit { border: 1px solid var(--border-strong); }
  .entry-btn.edit:hover { border-color: var(--primary); color: var(--primary-dark); background: var(--primary-bg); }
  .entry-btn.delete:hover { color: var(--danger); background: var(--danger-bg); }
  .meal-badge { font-size: 11px; color: var(--primary); background: var(--primary-bg); padding: 2px 8px; border-radius: var(--radius-full); font-weight: 500; }
  .entry-img { width: 100%; height: 200px; object-fit: contain; border-radius: var(--radius-sm); margin: 8px 0; background: var(--muted-bg); }
  .entry-text { margin: 4px 0 0; line-height: 1.45; font-size: 15px; white-space: pre-wrap; }
  .ingredients-details { margin: 4px 0 0; font-size: 12px; }
  .ingredients-details summary { cursor: pointer; color: var(--text-secondary); font-size: 12px; }
  .ingredients-details summary:hover { color: var(--primary); }
  .allergen-warning-banner {
    background: var(--warning-bg); border: 1px solid var(--warning-border); color: var(--warning-text);
    padding: 6px 10px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; margin: 6px 0;
  }
  .entry-allergen-warning {
    background: var(--warning-bg); border: 1px solid var(--warning-border); color: var(--warning-text);
    padding: 4px 8px; border-radius: var(--radius-xs); font-size: 12px; font-weight: 600; margin-bottom: 4px;
  }

  .edit-form { margin: 6px 0; }
  .edit-text {
    width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 13px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-xs);
    background: var(--surface); color: var(--text-primary); resize: vertical; margin-bottom: 4px;
  }
  .edit-row { display: flex; gap: 4px; align-items: center; }
  .edit-row select, .edit-row input { margin: 0; padding: 4px 6px; font-size: 13px; border: 1px solid var(--border-strong); border-radius: var(--radius-xs); }
  .edit-row select { flex: 1; }
  .edit-row input[type="time"] { flex: 1; }
  .edit-save { background: var(--primary); color: #fff; border: none; padding: 4px 10px; font-size: 13px; border-radius: var(--radius-xs); }
  .edit-cancel { background: none; border: none; color: var(--text-secondary); padding: 4px 6px; font-size: 13px; }

  .severity-row { display: flex; gap: 4px; align-items: center; margin: 8px 0; font-size: 13px; }
  .severity-btn { padding: 4px 8px; font-size: 12px; border: 1px solid var(--border-strong); background: var(--muted-bg); border-radius: var(--radius-xs); }
  .severity-btn.active { background: var(--warning); color: #fff; border-color: var(--warning); }
  .severity-badge { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); margin-left: 6px; font-weight: 500; }
  .severity-badge.s1 { background: var(--primary-bg); color: var(--primary-dark); }
  .severity-badge.s2 { background: var(--warning-bg); color: var(--warning-text); }
  .severity-badge.s3 { background: var(--danger-bg); color: var(--danger); }
  .severity-badge.s4 { background: var(--danger); color: #fff; }

  .reactions-section { margin-top: 20px; }
  .reaction-title { color: var(--danger); border-bottom-color: var(--danger-border); }

  /* ── Sheet overlays & modals ─────────────────────────── */
  .sheet-handle {
    width: 36px; height: 4px; margin: 0 auto 16px;
    background: var(--border-strong); border-radius: 2px;
    touch-action: none; cursor: grab;
  }
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 30;
    animation: overlay-in 0.2s ease-out;
  }
  .modal {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--surface); border-radius: var(--sheet-radius) var(--sheet-radius) 0 0;
    padding: 20px 20px calc(20px + var(--safe-bottom));
    box-shadow: var(--shadow-sheet); z-index: 40;
    max-height: 85vh; overflow-y: auto;
    animation: sheet-in 0.3s var(--spring);
  }
  .modal h3 { margin: 0 0 12px; }
  .modal-input { width: 100%; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-sizing: border-box; margin-bottom: 8px; font-size: 15px; background: var(--surface); }
  .modal-actions { display: flex; gap: 8px; margin-top: 12px; }
  .reaction-error { background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger); padding: 8px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 8px; }
  /* ── Barcode popover ──────────────────────────────────── */
  .popover {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--surface); border-radius: var(--radius-lg);
    padding: 20px; box-shadow: var(--shadow-lg); z-index: 40;
    width: min(420px, 92vw); max-height: 88vh; overflow-y: auto;
    animation: fade-in 0.25s var(--spring);
  }
  .popover-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .popover-header h3 { margin: 0; }
  .popover-close {
    width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%; border: none;
    background: var(--muted-bg); color: var(--text-secondary); font-size: 20px;
    display: flex; align-items: center; justify-content: center; line-height: 1;
  }
  .popover-close:hover { background: var(--border-strong); }

  .segmented-tabs { display: flex; gap: 4px; margin-bottom: 14px; background: var(--muted-bg); border-radius: var(--radius-sm); padding: 3px; }
  .segmented-tab {
    flex: 1; padding: 10px 8px; font-size: 14px; border: none; background: none;
    border-radius: 6px; font-weight: 600; color: var(--text-secondary); transition: background 0.15s, color 0.15s;
  }
  .segmented-tab.active { background: var(--surface); color: var(--text-primary); box-shadow: var(--shadow-xs); }
  .scan-hint { text-align: center; color: var(--text-tertiary); font-size: 12px; margin: 8px 0 0; }

  .manual-barcode-panel { padding: 4px 0 2px; }
  .manual-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }

  .barcode-result { margin-top: 12px; padding: 12px; background: var(--muted-bg); border-radius: var(--radius-md); }
  .manual-barcode-row { display: flex; gap: 8px; }
  .manual-barcode-input { flex: 1; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 16px; background: var(--surface); }
  .manual-barcode-btn {
    padding: 12px 16px; background: var(--primary); color: #fff; border: none;
    border-radius: var(--radius-sm); font-size: 14px; white-space: nowrap; font-weight: 600;
  }
  .manual-barcode-btn:disabled { opacity: 0.35; cursor: default; }
  .barcode-product-img { width: 100%; max-height: 160px; object-fit: contain; border-radius: var(--radius-sm); margin-bottom: 8px; }
  .barcode-result .submit { margin-top: 8px; }
  .allergens { color: var(--danger); font-weight: 600; }
  .not-found { color: var(--text-secondary); text-align: center; padding: 8px 0; }

  .fav-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--surface); border-radius: var(--radius-sm); margin-bottom: 6px; box-shadow: var(--shadow-xs); }
  .fav-text { flex: 1; min-width: 0; }
  .fav-text strong { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fav-text small { color: var(--text-tertiary); font-size: 11px; }
  .fav-actions { display: flex; gap: 2px; }

  .template-save-btn { width: 100%; margin-top: 6px; background: none; border: 1px dashed var(--border-strong); color: var(--text-secondary); font-size: 13px; padding: 8px; border-radius: var(--radius-sm); }
  .template-save-btn:hover { border-color: var(--primary); color: var(--primary); }

  /* ── Confirm dialogs (centered) ──────────────────────── */
  .confirm-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 50;
    animation: overlay-in 0.15s ease-out;
  }
  .confirm-dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--surface); border-radius: var(--radius-lg); padding: 24px;
    box-shadow: var(--shadow-lg); z-index: 60;
    width: 280px; text-align: center;
    animation: fade-in 0.2s var(--spring);
  }
  .confirm-dialog p { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  .confirm-sub { color: var(--text-secondary); font-size: 14px !important; font-weight: 400 !important; margin-bottom: 16px !important; }
  .empty-entry-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .empty-entry-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 12px; background: var(--primary); color: #fff; border: none;
    border-radius: var(--radius-sm); font-size: 15px; font-weight: 600;
  }
  .empty-entry-btn:hover { background: var(--primary-dark); }
  .confirm-actions { display: flex; gap: 8px; }
  .confirm-cancel { flex: 1; background: var(--muted-bg); border-color: var(--border-strong); }
  .confirm-delete { flex: 1; background: var(--danger); color: #fff; border-color: var(--danger); }
  .confirm-add { flex: 1; background: var(--primary); color: #fff; border-color: var(--primary); }
  .confirm-add:hover { background: var(--primary-dark); }
  .skip-warning-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; cursor: pointer; }
  .skip-warning-label input { margin: 0; }

  /* ── Calendar (bottom sheet) ─────────────────────────── */
  .calendar-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 10;
    animation: overlay-in 0.2s ease-out;
  }
  .calendar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--surface); border-radius: var(--sheet-radius) var(--sheet-radius) 0 0;
    padding: 20px 20px calc(20px + var(--safe-bottom));
    box-shadow: var(--shadow-sheet); z-index: 20;
    animation: sheet-in 0.3s var(--spring);
  }
  .calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .calendar-header span { font-weight: 600; font-size: 16px; }
  .calendar-header button { border: none; background: none; font-size: 20px; padding: 4px 12px; border-radius: var(--radius-sm); }
  .today-btn { display: block; width: 100%; margin-bottom: 8px; padding: 8px; background: var(--primary); color: #fff; border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; }
  .today-btn:hover { background: var(--primary-dark); }
  .calendar-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
  .day-label { font-size: 12px; color: var(--text-tertiary); padding: 4px 0; font-weight: 600; }
  .day { padding: 10px 0; border-radius: var(--radius-sm); border: none; background: none; cursor: pointer; font-size: 15px; position: relative; font-weight: 500; transition: background 0.1s; }
  .day.empty { cursor: default; }
  .day.today { font-weight: 700; color: #fff; background: var(--primary); box-shadow: 0 2px 8px rgba(52,199,89,0.35); }
  .day.selected { background: var(--text-primary); color: var(--bg); font-weight: 600; }
  .day.heat-1 { background: var(--primary-bg); font-weight: 500; }
  .day.heat-2 { background: var(--primary-bg-strong); font-weight: 500; }
  .day.heat-3 { background: var(--primary-dark); color: #fff; font-weight: 600; }
  .day.heat-3 .dot { background: #fff; }
  .day:hover:not(.empty):not(.selected):not(.today) { background: var(--border); }
  .dot { display: block; width: 4px; height: 4px; border-radius: 50%; background: var(--primary); margin: 2px auto 0; }
  .reaction-dot { display: block; width: 6px; height: 6px; border-radius: 50%; background: var(--danger); margin: 2px auto 0; }
</style>
