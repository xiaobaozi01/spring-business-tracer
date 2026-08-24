package com.acme.notification.messaging;

import com.acme.notification.service.NotificationService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class AnalyticsCheckoutListener {
    private final NotificationService service;
    public AnalyticsCheckoutListener(NotificationService service) { this.service = service; }
    @KafkaListener(topics = "checkout.created", groupId = "analytics-workers")
    public void consume(String sku) { service.recordAnalytics(sku); }
}
