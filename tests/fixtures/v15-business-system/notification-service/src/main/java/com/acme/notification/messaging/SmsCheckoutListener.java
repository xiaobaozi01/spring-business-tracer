package com.acme.notification.messaging;

import com.acme.notification.service.NotificationService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class SmsCheckoutListener {
    private final NotificationService service;
    public SmsCheckoutListener(NotificationService service) { this.service = service; }
    @KafkaListener(topics = "checkout.created", groupId = "notification-workers")
    public void consume(String sku) { service.recordSms(sku); }
}
