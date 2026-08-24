package com.acme.worker.job;
import com.acme.worker.service.ReconcileService;
import org.quartz.JobExecutionContext;
import org.springframework.scheduling.quartz.QuartzJobBean;
import com.acme.worker.messaging.BillingPublisher;
import org.springframework.beans.factory.annotation.Autowired;
public class ReconcileJob extends QuartzJobBean {
    @Autowired private ReconcileService service;
    @Autowired private BillingPublisher publisher;
    @Override protected void executeInternal(JobExecutionContext context) { service.run(); publisher.publish("reconcile"); }
}
