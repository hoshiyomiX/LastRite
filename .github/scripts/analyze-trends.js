#!/usr/bin/env node
/**
 * Performance Trend Analysis Script
 * 
 * Analyzes historical metrics to identify trends, regressions, and anomalies
 * Generates recommendations based on statistical analysis
 */

const fs = require('fs');
const path = require('path');

// Configuration
const METRICS_DIR = path.join(__dirname, '../monitoring/metrics');
const LOOKBACK_HOURS = 24;
const REGRESSION_THRESHOLD = 20; // % increase = regression
const ANOMALY_STDDEV = 2.5; // Standard deviations for anomaly

/**
 * Load all metrics files from the last N hours
 */
function loadRecentMetrics(hours = LOOKBACK_HOURS) {
  if (!fs.existsSync(METRICS_DIR)) {
    console.error('Metrics directory not found:', METRICS_DIR);
    return [];
  }

  const files = fs.readdirSync(METRICS_DIR)
    .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
  const metrics = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(METRICS_DIR, file), 'utf8');
      const data = JSON.parse(content);
      const timestamp = new Date(data.timestamp).getTime();

      if (timestamp >= cutoffTime) {
        metrics.push(data);
      } else {
        break; // Files are sorted, so we can stop here
      }
    } catch (error) {
      console.error(`Error loading ${file}:`, error.message);
    }
  }

  return metrics.reverse(); // Return in chronological order
}

/**
 * Calculate statistical metrics
 */
function calculateStats(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: mean,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    stdDev: stdDev,
    count: values.length
  };
}

/**
 * Detect anomalies using Z-score method
 */
function detectAnomalies(metrics, valueExtractor, threshold = ANOMALY_STDDEV) {
  const values = metrics.map(valueExtractor).filter(v => v != null);
  const stats = calculateStats(values);

  if (!stats) return [];

  const anomalies = [];

  metrics.forEach((metric, idx) => {
    const value = valueExtractor(metric);
    if (value == null) return;

    const zScore = Math.abs((value - stats.mean) / stats.stdDev);

    if (zScore > threshold) {
      anomalies.push({
        timestamp: metric.timestamp,
        value: value,
        zScore: zScore.toFixed(2),
        deviation: ((value - stats.mean) / stats.mean * 100).toFixed(2) + '%'
      });
    }
  });

  return anomalies;
}

/**
 * Detect performance regression (comparing recent vs baseline)
 */
function detectRegression(metrics, valueExtractor, metricName) {
  if (metrics.length < 10) return null;

  // Compare recent 25% vs baseline 75%
  const splitPoint = Math.floor(metrics.length * 0.25);
  const recent = metrics.slice(-splitPoint);
  const baseline = metrics.slice(0, -splitPoint);

  const recentValues = recent.map(valueExtractor).filter(v => v != null);
  const baselineValues = baseline.map(valueExtractor).filter(v => v != null);

  const recentStats = calculateStats(recentValues);
  const baselineStats = calculateStats(baselineValues);

  if (!recentStats || !baselineStats) return null;

  const change = ((recentStats.mean - baselineStats.mean) / baselineStats.mean) * 100;
  const isRegression = change > REGRESSION_THRESHOLD;

  return {
    metric: metricName,
    baseline: baselineStats.mean.toFixed(2),
    recent: recentStats.mean.toFixed(2),
    change: change.toFixed(2) + '%',
    isRegression: isRegression,
    severity: isRegression ? (change > 50 ? 'critical' : 'warning') : 'ok'
  };
}

/**
 * Generate ASCII sparkline
 */
function generateSparkline(values, width = 40) {
  if (values.length === 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) return '▁'.repeat(width);

  const bars = '▁▂▃▄▅▆▇█';
  const normalized = values.map(v => Math.floor(((v - min) / range) * (bars.length - 1)));

  // Sample to fit width
  const step = Math.max(1, Math.floor(normalized.length / width));
  const sampled = normalized.filter((_, idx) => idx % step === 0).slice(0, width);

  return sampled.map(idx => bars[idx]).join('');
}

/**
 * Main analysis function
 */
function analyzeMetrics() {
  console.log('\n📈 Performance Trend Analysis\n');
  console.log('=' .repeat(60));

  const metrics = loadRecentMetrics(LOOKBACK_HOURS);

  if (metrics.length === 0) {
    console.log('\n⚠️  No metrics data found');
    console.log('Metrics will be collected after the first benchmark run.');
    return;
  }

  console.log(`\n📋 Data Range: ${LOOKBACK_HOURS}h (${metrics.length} samples)`);
  console.log(`   From: ${new Date(metrics[0].timestamp).toISOString()}`);
  console.log(`   To:   ${new Date(metrics[metrics.length - 1].timestamp).toISOString()}`);

  // Extract time series data
  const p95Latencies = metrics.map(m => m.benchmark?.latency?.p95).filter(Boolean);
  const throughputs = metrics.map(m => m.benchmark?.requests_per_sec).filter(Boolean);
  const dedupEfficiencies = metrics.map(m => parseFloat(m.deduplication?.dedup_efficiency || 0)).filter(Boolean);
  const errorRates = metrics.map(m => {
    const b = m.benchmark;
    if (!b) return null;
    return ((b.errors + b.timeouts) / b.requests.total) * 100;
  }).filter(v => v != null);

  // Statistical summary
  console.log('\n📊 Statistical Summary\n');

  const stats = {
    'P95 Latency (ms)': calculateStats(p95Latencies),
    'Throughput (req/s)': calculateStats(throughputs),
    'Dedup Efficiency (%)': calculateStats(dedupEfficiencies),
    'Error Rate (%)': calculateStats(errorRates)
  };

  Object.entries(stats).forEach(([name, stat]) => {
    if (!stat) return;
    console.log(`${name}:`);
    console.log(`  Mean: ${stat.mean.toFixed(2)}  Median: ${stat.median.toFixed(2)}  P95: ${stat.p95.toFixed(2)}`);
    console.log(`  Range: [${stat.min.toFixed(2)} - ${stat.max.toFixed(2)}]  StdDev: ${stat.stdDev.toFixed(2)}`);
    console.log('');
  });

  // Sparklines
  console.log('\n📉 Trend Visualization (last 24h)\n');
  console.log(`P95 Latency:    ${generateSparkline(p95Latencies)}`);
  console.log(`Throughput:     ${generateSparkline(throughputs)}`);
  console.log(`Dedup Eff:      ${generateSparkline(dedupEfficiencies)}`);
  console.log(`Error Rate:     ${generateSparkline(errorRates)}`);

  // Regression detection
  console.log('\n\n🔍 Regression Analysis\n');

  const regressions = [
    detectRegression(metrics, m => m.benchmark?.latency?.p95, 'P95 Latency'),
    detectRegression(metrics, m => m.benchmark?.requests_per_sec, 'Throughput'),
    detectRegression(metrics, m => parseFloat(m.deduplication?.dedup_efficiency || 0), 'Dedup Efficiency')
  ].filter(Boolean);

  regressions.forEach(reg => {
    const icon = reg.severity === 'critical' ? '🚨' : reg.severity === 'warning' ? '⚠️' : '✅';
    console.log(`${icon} ${reg.metric}:`);
    console.log(`   Baseline: ${reg.baseline}  Recent: ${reg.recent}  Change: ${reg.change}`);
    if (reg.isRegression) {
      console.log(`   ⚠️  REGRESSION DETECTED (${reg.severity.toUpperCase()})`);
    }
    console.log('');
  });

  // Anomaly detection
  console.log('\n🔴 Anomaly Detection\n');

  const anomalies = [
    { name: 'P95 Latency', data: detectAnomalies(metrics, m => m.benchmark?.latency?.p95) },
    { name: 'Error Rate', data: detectAnomalies(metrics, m => {
      const b = m.benchmark;
      if (!b) return null;
      return ((b.errors + b.timeouts) / b.requests.total) * 100;
    }) }
  ];

  anomalies.forEach(({ name, data }) => {
    if (data.length === 0) {
      console.log(`✅ ${name}: No anomalies detected`);
    } else {
      console.log(`⚠️  ${name}: ${data.length} anomalies detected`);
      data.slice(0, 5).forEach(a => {
        console.log(`   - ${a.timestamp}: ${a.value} (${a.deviation} from mean, z-score: ${a.zScore})`);
      });
    }
  });

  // Recommendations
  console.log('\n\n💡 Recommendations\n');

  const recommendations = [];

  // Check P95 latency
  if (stats['P95 Latency (ms)']?.mean > 1000) {
    recommendations.push({
      priority: 'high',
      category: 'Performance',
      issue: `Average P95 latency is ${stats['P95 Latency (ms)'].mean.toFixed(2)}ms (target: <1000ms)`,
      action: 'Increase TIMEOUT_MAX or optimize connection pooling'
    });
  }

  // Check deduplication
  if (stats['Dedup Efficiency (%)']?.mean < 70) {
    recommendations.push({
      priority: 'medium',
      category: 'Optimization',
      issue: `Average dedup efficiency is ${stats['Dedup Efficiency (%)'].mean.toFixed(2)}% (target: >70%)`,
      action: 'Increase REQUEST_COALESCE_TTL from 2000ms to 3000ms'
    });
  }

  // Check error rate
  if (stats['Error Rate (%)']?.mean > 1) {
    recommendations.push({
      priority: 'critical',
      category: 'Reliability',
      issue: `Average error rate is ${stats['Error Rate (%)'].mean.toFixed(2)}% (target: <1%)`,
      action: 'Review retry logic and increase RETRY_MAX_ATTEMPTS'
    });
  }

  // Check regressions
  regressions.filter(r => r.isRegression).forEach(reg => {
    recommendations.push({
      priority: reg.severity,
      category: 'Regression',
      issue: `${reg.metric} degraded by ${reg.change}`,
      action: 'Review recent code changes and consider rollback'
    });
  });

  if (recommendations.length === 0) {
    console.log('✅ All metrics are within acceptable ranges');
    console.log('\nNo immediate action required. Continue monitoring.');
  } else {
    recommendations.forEach((rec, idx) => {
      const icon = rec.priority === 'critical' ? '🚨' : rec.priority === 'high' ? '⚠️' : '💡';
      console.log(`${idx + 1}. ${icon} [${rec.priority.toUpperCase()}] ${rec.category}`);
      console.log(`   Issue: ${rec.issue}`);
      console.log(`   Action: ${rec.action}`);
      console.log('');
    });
  }

  // Export summary
  const summary = {
    timestamp: new Date().toISOString(),
    lookback_hours: LOOKBACK_HOURS,
    sample_count: metrics.length,
    statistics: stats,
    regressions: regressions.filter(r => r.isRegression),
    anomaly_count: anomalies.reduce((sum, a) => sum + a.data.length, 0),
    recommendations: recommendations,
    health_score: calculateHealthScore(stats, regressions, anomalies)
  };

  fs.writeFileSync(
    path.join(__dirname, '../monitoring/trend-analysis.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Analysis complete. Health Score: ${summary.health_score}/100`);
  console.log(`   Report saved to: .github/monitoring/trend-analysis.json\n`);
}

/**
 * Calculate overall health score (0-100)
 */
function calculateHealthScore(stats, regressions, anomalies) {
  let score = 100;

  // Deduct for high latency
  if (stats['P95 Latency (ms)']?.mean > 2000) score -= 30;
  else if (stats['P95 Latency (ms)']?.mean > 1000) score -= 15;

  // Deduct for high error rate
  if (stats['Error Rate (%)']?.mean > 5) score -= 40;
  else if (stats['Error Rate (%)']?.mean > 1) score -= 20;

  // Deduct for low dedup efficiency
  if (stats['Dedup Efficiency (%)']?.mean < 50) score -= 20;
  else if (stats['Dedup Efficiency (%)']?.mean < 70) score -= 10;

  // Deduct for regressions
  const criticalRegressions = regressions.filter(r => r.isRegression && r.severity === 'critical').length;
  const warningRegressions = regressions.filter(r => r.isRegression && r.severity === 'warning').length;
  score -= (criticalRegressions * 15 + warningRegressions * 5);

  // Deduct for anomalies
  const totalAnomalies = anomalies.reduce((sum, a) => sum + a.data.length, 0);
  score -= Math.min(15, totalAnomalies * 2);

  return Math.max(0, Math.min(100, score));
}

// Run analysis
if (require.main === module) {
  try {
    analyzeMetrics();
  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { analyzeMetrics, loadRecentMetrics, calculateStats };
