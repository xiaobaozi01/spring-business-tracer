package com.acme.order.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(name = "customer-service", path = "/internal/customers")
public interface CustomerClient {
    @GetMapping("/{id}/active")
    void requireActive(@PathVariable("id") Long id);
}
