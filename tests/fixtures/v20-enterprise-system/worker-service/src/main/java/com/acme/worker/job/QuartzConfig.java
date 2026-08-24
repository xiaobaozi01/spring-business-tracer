package com.acme.worker.job;

import org.quartz.JobBuilder;
import org.quartz.JobDetail;
import org.quartz.SimpleScheduleBuilder;
import org.quartz.Trigger;
import org.quartz.TriggerBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.quartz.SchedulerFactoryBean;

@Configuration
@ComponentScan("com.acme.worker")
public class QuartzConfig {
    @Bean JobDetail reconcileJobDetail() {
        return JobBuilder.newJob(ReconcileJob.class).withIdentity("reconcile-job").storeDurably().build();
    }
    @Bean Trigger nightlyTrigger(JobDetail reconcileJobDetail) {
        return TriggerBuilder.newTrigger().withIdentity("nightly-trigger").forJob(reconcileJobDetail)
            .withSchedule(SimpleScheduleBuilder.simpleSchedule().withIntervalInHours(24).repeatForever()).build();
    }
    @Bean SchedulerFactoryBean schedulerFactory(AutowiringJobFactory jobFactory, JobDetail reconcileJobDetail, Trigger nightlyTrigger) {
        SchedulerFactoryBean factory = new SchedulerFactoryBean();
        factory.setJobFactory(jobFactory);
        factory.setJobDetails(reconcileJobDetail);
        factory.setTriggers(nightlyTrigger);
        return factory;
    }
    @Bean AutowiringJobFactory autowiringJobFactory() { return new AutowiringJobFactory(); }
}
