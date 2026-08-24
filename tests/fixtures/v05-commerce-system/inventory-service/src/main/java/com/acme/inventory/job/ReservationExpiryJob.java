package com.acme.inventory.job;

import com.acme.inventory.service.InventoryService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ReservationExpiryJob {
    private final InventoryService inventoryService;

    public ReservationExpiryJob(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Scheduled(cron = "0 */5 * * * *")
    public void releaseExpired() {
        inventoryService.releaseExpired();
    }
}
