package com.acme.order.client;

import com.acme.order.client.dto.ReserveStockRequest;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@FeignClient(name = "inventory-service", path = "/internal/inventory")
public interface InventoryClient {
    @PostMapping("/reserve")
    void reserve(@RequestBody ReserveStockRequest request);
}
