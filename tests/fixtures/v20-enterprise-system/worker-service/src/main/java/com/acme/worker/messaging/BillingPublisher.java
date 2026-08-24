package com.acme.worker.messaging;

import org.springframework.jms.core.JmsTemplate;
import org.springframework.stereotype.Component;

@Component
public class BillingPublisher {
    private final JmsTemplate template;
    public BillingPublisher(JmsTemplate template) { this.template = template; }
    public void publish(String orderId) { template.convertAndSend("billing.request", orderId); }
}
