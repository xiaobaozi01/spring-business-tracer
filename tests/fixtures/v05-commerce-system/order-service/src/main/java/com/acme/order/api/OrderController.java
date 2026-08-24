package com.acme.order.api;

import com.acme.order.service.CheckoutService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final CheckoutService checkoutService;

    public OrderController(CheckoutService checkoutService) {
        this.checkoutService = checkoutService;
    }

    @PostMapping
    public Long create(@RequestBody CreateOrderRequest request) {
        return checkoutService.create(request.getBizNo(), request.getCustomerId(), request.getSku(), request.getQuantity());
    }
}
