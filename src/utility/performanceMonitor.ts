// Performance monitoring utility to track startup optimizations

interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private appStartTime: number;

  constructor() {
    this.appStartTime = performance.now();
    this.startTiming("app_startup");
  }

  startTiming(name: string): void {
    this.metrics.set(name, {
      name,
      startTime: performance.now(),
    });
  }

  endTiming(name: string): number | undefined {
    const metric = this.metrics.get(name);
    if (!metric) {
      console.warn(`No timing started for: ${name}`);
      return;
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    console.log(`[Performance] ${name}: ${metric.duration.toFixed(2)}ms`);
    return metric.duration;
  }

  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.get(name);
  }

  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  getFormattedReport(): string {
    const report = ["=== Performance Report ==="];

    this.metrics.forEach((metric) => {
      if (metric.duration !== undefined) {
        report.push(`${metric.name}: ${metric.duration.toFixed(2)}ms`);
      } else {
        report.push(`${metric.name}: still running...`);
      }
    });

    const totalTime = performance.now() - this.appStartTime;
    report.push(`Total time since app start: ${totalTime.toFixed(2)}ms`);

    return report.join("\n");
  }

  // Memory usage tracking
  getMemoryUsage(): any {
    if ("memory" in performance) {
      // @ts-ignore - performance.memory exists in Chrome
      return performance.memory;
    }
    return null;
  }

  // Bundle size tracking
  trackBundleLoad(bundleName: string, startTime: number): void {
    const loadTime = performance.now() - startTime;
    console.log(`[Bundle] ${bundleName} loaded in ${loadTime.toFixed(2)}ms`);
    this.metrics.set(`bundle_${bundleName}`, {
      name: `bundle_${bundleName}`,
      startTime,
      endTime: performance.now(),
      duration: loadTime,
    });
  }

  // Schema loading tracking
  trackSchemaLoad(game: string, startTime: number): void {
    const loadTime = performance.now() - startTime;
    console.log(`[Schema] ${game} schema loaded in ${loadTime.toFixed(2)}ms`);
    this.metrics.set(`schema_${game}`, {
      name: `schema_${game}`,
      startTime,
      endTime: performance.now(),
      duration: loadTime,
    });
  }

  // Component loading tracking
  trackComponentLoad(componentName: string, startTime: number): void {
    const loadTime = performance.now() - startTime;
    console.log(`[Component] ${componentName} loaded in ${loadTime.toFixed(2)}ms`);
    this.metrics.set(`component_${componentName}`, {
      name: `component_${componentName}`,
      startTime,
      endTime: performance.now(),
      duration: loadTime,
    });
  }

  // Network request tracking
  trackNetworkRequest(url: string, startTime: number): void {
    const requestTime = performance.now() - startTime;
    console.log(`[Network] ${url} completed in ${requestTime.toFixed(2)}ms`);
    this.metrics.set(`network_${url}`, {
      name: `network_${url}`,
      startTime,
      endTime: performance.now(),
      duration: requestTime,
    });
  }

  // Export metrics for analysis
  exportMetrics(): string {
    return JSON.stringify(
      {
        appStartTime: this.appStartTime,
        currentTime: performance.now(),
        totalElapsed: performance.now() - this.appStartTime,
        metrics: Array.from(this.metrics.entries()),
        memoryUsage: this.getMemoryUsage(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }
}

// Global performance monitor instance
export const perfMonitor = new PerformanceMonitor();

// Helper functions for easy use
export const startTiming = (name: string) => perfMonitor.startTiming(name);
export const endTiming = (name: string) => perfMonitor.endTiming(name);
export const trackBundleLoad = (bundleName: string, startTime: number) =>
  perfMonitor.trackBundleLoad(bundleName, startTime);
export const trackSchemaLoad = (game: string, startTime: number) =>
  perfMonitor.trackSchemaLoad(game, startTime);
export const trackComponentLoad = (componentName: string, startTime: number) =>
  perfMonitor.trackComponentLoad(componentName, startTime);

// Development helper - log performance report
if (process.env.NODE_ENV === "development") {
  // Log performance report after app is fully loaded
  setTimeout(() => {
    console.log(perfMonitor.getFormattedReport());
  }, 5000);
}

export default perfMonitor;
