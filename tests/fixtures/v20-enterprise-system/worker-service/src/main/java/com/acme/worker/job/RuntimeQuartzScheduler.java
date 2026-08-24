package com.acme.worker.job;

import org.quartz.JobDetail;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.Trigger;
import org.springframework.stereotype.Component;

@Component
public class RuntimeQuartzScheduler {
    public void scheduleAtRuntime(Scheduler scheduler, JobDetail job, Trigger runtimeTrigger) throws SchedulerException {
        scheduler.scheduleJob(job, runtimeTrigger);
    }
}
