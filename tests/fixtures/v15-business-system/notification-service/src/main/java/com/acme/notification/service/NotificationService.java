package com.acme.notification.service;

import com.acme.notification.repository.NotificationRepository;
import org.springframework.stereotype.Service;

@Service
public class NotificationService {
    private final NotificationRepository repository;
    public NotificationService(NotificationRepository repository) { this.repository = repository; }
    public void recordEmail(String sku) { repository.insert(sku, "EMAIL"); }
    public void recordSms(String sku) { repository.insert(sku, "SMS"); }
    public void recordAnalytics(String sku) { repository.insert(sku, "ANALYTICS"); }
}
