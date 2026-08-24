package com.acme.worker.messaging;

import com.acme.worker.service.BillingService;
import org.springframework.jms.annotation.JmsListener;
import org.springframework.stereotype.Component;

@Component
public class BillingListener {
    private final BillingService service;
    public BillingListener(BillingService service) { this.service = service; }
    @JmsListener(destination = "${billing.queue}")
    public void consume(String orderId) { service.process(orderId); }
}
