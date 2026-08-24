package com.acme.order.service;

import com.acme.order.mapper.OrderMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderServiceImpl implements OrderService {
    private final OrderMapper orderMapper;

    public OrderServiceImpl(OrderMapper orderMapper) {
        this.orderMapper = orderMapper;
    }

    @Override
    @Transactional
    public Long create(String bizNo, Long customerId) {
        if (orderMapper.existsByBizNo(bizNo)) {
            throw new IllegalStateException("订单号已存在");
        }
        orderMapper.insertOrder(bizNo, customerId);
        return orderMapper.findIdByBizNo(bizNo);
    }
}
