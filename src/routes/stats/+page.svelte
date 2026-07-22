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

    {#if stats.dailyCounts?.length > 1}
      {@const maxVal = Math.max(1, ...stats.dailyCounts.map((d: any) => Math.max(d.foods, d.reactions)))}
      {@const barW = 100 / stats.dailyCounts.length}
      <div class="section">
        <h2>Trend</h2>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" class="trend-chart">
          {#each stats.dailyCounts as d, i}
            {@const foodH = (d.foods / maxVal) * 54}
            {@const reactH = (d.reactions / maxVal) * 54}
            <rect x={i * barW + barW * 0.15} y={56 - foodH} width={barW * 0.32} height={foodH} fill="var(--primary)" rx="0.5" />
            <rect x={i * barW + barW * 0.53} y={56 - reactH} width={barW * 0.32} height={reactH} fill="var(--danger)" rx="0.5" />
          {/each}
        </svg>
        <div class="trend-labels">
          <span>{new Date(stats.dailyCounts[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span>{new Date(stats.dailyCounts[stats.dailyCounts.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        <div class="trend-legend">
          <span><span class="legend-dot foods"></span> Foods</span>
          <span><span class="legend-dot reactions"></span> Reactions</span>
        </div>
      </div>
    {/if}

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
  main { max-width: 560px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
  .back { text-decoration: none; color: var(--primary); font-size: 20px; }

  .period-btns { display: flex; gap: 4px; margin-bottom: 16px; background: var(--muted-bg); border-radius: var(--radius-sm); padding: 3px; }
  .period-btns button {
    flex: 1; padding: 8px; font-size: 13px; border: none;
    background: none; border-radius: 6px; font-weight: 500; color: var(--text-secondary);
    transition: all 0.15s;
  }
  .period-btns button.active { background: var(--surface); color: var(--text-primary); box-shadow: var(--shadow-xs); }

  .summary { display: flex; gap: 12px; margin-bottom: 24px; }
  .stat-card {
    flex: 1; padding: 20px 16px; border-radius: var(--radius-md); text-align: center;
    background: linear-gradient(135deg, var(--primary-bg), var(--primary-bg-strong));
    box-shadow: var(--shadow-sm);
  }
  .stat-card.reaction { background: linear-gradient(135deg, var(--danger-bg), var(--danger-border)); }
  .stat-num { font-size: 32px; font-weight: 700; color: var(--primary-dark); letter-spacing: -0.02em; }
  .stat-card.reaction .stat-num { color: var(--danger); }
  .stat-label { font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-weight: 500; }

  .section { margin-bottom: 24px; }

  .trend-chart { width: 100%; height: 90px; display: block; }
  .trend-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
  .trend-legend { display: flex; gap: 16px; justify-content: center; font-size: 12px; color: var(--text-secondary); margin-top: 8px; }
  .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .legend-dot.foods { background: var(--primary); }
  .legend-dot.reactions { background: var(--danger); }
  .subtitle { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }

  .corr-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px; background: var(--surface); border-radius: var(--radius-sm);
    margin-bottom: 6px; box-shadow: var(--shadow-xs);
  }
  .corr-food { font-size: 14px; font-weight: 500; }
  .corr-count { font-size: 12px; color: var(--danger); font-weight: 600; }

  .reaction-item {
    padding: 12px; background: var(--surface); border-radius: var(--radius-sm);
    margin-bottom: 6px; box-shadow: var(--shadow-xs);
  }
  .reaction-item small { color: var(--text-tertiary); }
  .reaction-item p { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); }
  .severity { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); margin-left: 6px; font-weight: 500; }
  .severity.s1 { background: var(--primary-bg); color: var(--primary-dark); }
  .severity.s2 { background: var(--warning-bg); color: var(--warning-text); }
  .severity.s3 { background: var(--danger-bg); color: var(--danger); }
  .severity.s4 { background: var(--danger); color: #fff; }

  .empty, .loading { text-align: center; color: var(--text-tertiary); padding: 32px 0; }
</style>
