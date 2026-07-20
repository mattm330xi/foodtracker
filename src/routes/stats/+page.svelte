<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  let stats: any = $state(null);
  let days = $state(7);

  async function loadStats() {
    const res = await fetch(`/api/stats?days=${days}`);
    if (res.status === 401) { goto('/login'); return; }
    stats = await res.json();
  }

  onMount(loadStats);

  function setDays(d: number) {
    days = d;
    loadStats();
  }
</script>

<svelte:head>
  <title>Stats - Food Tracker</title>
</svelte:head>

<main>
  <header>
    <h1><a href="/" class="back">←</a> Stats</h1>
  </header>

  <div class="period-btns">
    <button class:active={days === 3} onclick={() => setDays(3)}>3 days</button>
    <button class:active={days === 7} onclick={() => setDays(7)}>7 days</button>
    <button class:active={days === 14} onclick={() => setDays(14)}>14 days</button>
    <button class:active={days === 30} onclick={() => setDays(30)}>30 days</button>
  </div>

  {#if stats}
    <div class="summary">
      <div class="stat-card">
        <div class="stat-num">{stats.totalFoods}</div>
        <div class="stat-label">Food entries</div>
      </div>
      <div class="stat-card reaction">
        <div class="stat-num">{stats.totalReactions}</div>
        <div class="stat-label">Reactions</div>
      </div>
    </div>

    {#if stats.correlations.length > 0}
      <div class="section">
        <h2>Possible triggers</h2>
        <p class="subtitle">Foods eaten on days with reactions</p>
        {#each stats.correlations as c}
          <div class="corr-item">
            <div class="corr-food">{c.food}</div>
            <div class="corr-count">{c.reactionCount} reaction{c.reactionCount > 1 ? 's' : ''}</div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">No reaction correlations found in this period</div>
    {/if}

    {#if stats.reactions.length > 0}
      <div class="section">
        <h2>Recent reactions</h2>
        {#each stats.reactions as r}
          <div class="reaction-item">
            <div>
              <strong>{r.symptom}</strong>
              <span class="severity s{r.severity}">{['','Mild','Moderate','Severe','Very Severe'][r.severity]}</span>
            </div>
            <small>{r.date}</small>
            {#if r.notes}<p>{r.notes}</p>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="loading">Loading...</div>
  {/if}
</main>

<style>
  main { max-width: 480px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  .back { text-decoration: none; color: #4CAF50; font-size: 20px; }

  .period-btns { display: flex; gap: 6px; margin-bottom: 16px; }
  .period-btns button { flex: 1; padding: 8px; font-size: 13px; border: 1px solid #ccc; background: #f5f5f5; border-radius: 8px; cursor: pointer; }
  .period-btns button.active { background: #4CAF50; color: #fff; border-color: #4CAF50; }

  .summary { display: flex; gap: 12px; margin-bottom: 20px; }
  .stat-card { flex: 1; padding: 16px; border-radius: 12px; background: #e8f5e9; text-align: center; }
  .stat-card.reaction { background: #ffebee; }
  .stat-num { font-size: 28px; font-weight: 700; color: #2e7d32; }
  .stat-card.reaction .stat-num { color: #c62828; }
  .stat-label { font-size: 12px; color: #666; margin-top: 4px; }

  .section { margin-bottom: 20px; }
  .subtitle { font-size: 12px; color: #888; margin: 0 0 8px; }

  .corr-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 6px; background: #fff5f5; }
  .corr-food { font-size: 14px; font-weight: 500; }
  .corr-count { font-size: 12px; color: #c00; font-weight: 600; }

  .reaction-item { padding: 10px 12px; border: 1px solid #ffcdd2; border-radius: 8px; margin-bottom: 6px; background: #fff5f5; }
  .reaction-item small { color: #888; }
  .reaction-item p { margin: 4px 0 0; font-size: 13px; color: #666; }
  .severity { font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  .severity.s1 { background: #e8f5e9; color: #2e7d32; }
  .severity.s2 { background: #fff3e0; color: #e65100; }
  .severity.s3 { background: #fbe9e7; color: #c62828; }
  .severity.s4 { background: #c62828; color: #fff; }

  .empty, .loading { text-align: center; color: #aaa; padding: 32px 0; }
</style>
